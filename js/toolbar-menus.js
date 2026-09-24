/**
 * @module toolbar-menus
 * @description Toolbar UX: hover-expansion state, the undo/redo history
 * panel (hover submenu with progressive selection preview and
 * jump-to-state), the "more" hover menu, and the done-task filter control.
 */
import { dom } from "./dom.js";
import { history } from "./history.js";
import { hasSemanticDiff, showDiffModal } from "./diff.js";

/**
 * @typedef {object} AppActions
 * @property {Function} renderNodes    Re-renders all nodes.
 * @property {Function} autoArrange    Runs the automatic layout.
 * @property {Function} undo           Steps one entry back in history.
 * @property {Function} redo           Steps one entry forward in history.
 * @property {Function} toggleDarkMode Toggles dark mode.
 * @property {Function} exportData     Exports the graph as JSON.
 */

/** Hover delay (ms) before a submenu opens. */
const SUBMENU_DELAY = 500;
/** Hide delay (ms) after the pointer leaves the panel area. */
const HIDE_DELAY = 280;

/**
 * Persian relative-time formatting for history entries.
 *
 * @param {number} ts Timestamp to format.
 * @returns {string}
 */
function formatRelTime(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "همین الان";
  if (sec < 3600) return Math.floor(sec / 60) + " دقیقه پیش";
  if (sec < 86400) return Math.floor(sec / 3600) + " ساعت پیش";
  return new Date(ts).toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Syncs the filter button's label, dot color, tooltip and pressed state
 * with the current body class.
 *
 * @returns {void}
 */
function syncFilterUI() {
  const filterBtn = document.getElementById("tool-filter-active");
  if (!filterBtn) return;
  const on = document.body.classList.contains("filter-active");
  filterBtn.setAttribute("aria-pressed", String(on));
  filterBtn.classList.toggle("active-filter", on);
  const text = on ? "عدم نمایش انجام‌شده‌ها" : "نمایش انجام‌شده‌ها";
  const label = filterBtn.querySelector(".tool-label");
  if (label) label.textContent = text;
  filterBtn.title = `${text} (Ctrl+D)`;
  filterBtn.setAttribute("aria-label", text);
}

/**
 * Toggles the done-task filter and persists the preference. Callers are
 * responsible for re-running the layout afterwards (the button click and
 * the Ctrl+D shortcut both do).
 *
 * @returns {void}
 */
export function toggleFilter() {
  document.body.classList.toggle("filter-active");
  localStorage.setItem(
    "filterActive",
    document.body.classList.contains("filter-active"),
  );
  syncFilterUI();
}

/**
 * Wires every toolbar menu behavior.
 *
 * @param {AppActions} actions Application callbacks.
 * @returns {void}
 */
export function setupToolbarMenus(actions) {
  const undoBtn = document.getElementById("tool-undo");
  const redoBtn = document.getElementById("tool-redo");
  const undoGroup = document.getElementById("undo-group");
  const toolsEl = document.querySelector(".tools");

  let historyHideTimer = null;
  let historyOpenTimer = null;
  let moreOpenTimer = null;

  /* ---------------------------------------------------------- *
   * Expansion state helpers
   * ---------------------------------------------------------- */

  /**
   * Toggles the toolbar's expanded class (pinned-open state used while a
   * submenu is open, since :hover alone would collapse it).
   *
   * @param {boolean} on
   * @returns {void}
   */
  function setToolsExpanded(on) {
    if (toolsEl) toolsEl.classList.toggle("is-expanded", !!on);
  }

  /** Cancels a pending history-panel open timer. @returns {void} */
  function cancelHistoryOpen() {
    if (historyOpenTimer) {
      clearTimeout(historyOpenTimer);
      historyOpenTimer = null;
    }
  }

  /** Cancels a pending more-menu open timer. @returns {void} */
  function cancelMoreOpen() {
    if (moreOpenTimer) {
      clearTimeout(moreOpenTimer);
      moreOpenTimer = null;
    }
  }

  /** Removes the `submenu-open` highlight from every tool button. @returns {void} */
  function clearSubmenuOpenClass() {
    document
      .querySelectorAll(".tool-btn.submenu-open")
      .forEach((el) => el.classList.remove("submenu-open"));
  }

  /* ---------------------------------------------------------- *
   * History panel
   * ---------------------------------------------------------- */

  /**
   * Builds and shows the history panel for a mode.
   *
   * Undo lists the most recent step first; redo lists the furthest step
   * first (both rendered top-to-bottom). Rows carry a progressive hover
   * preview (dimming every step that would be traversed), a "..." diff
   * button for semantically meaningful steps only, click-to-jump, and
   * Enter/Space keyboard support.
   *
   * @param {("undo"|"redo")} mode
   * @returns {void}
   */
  function showHistoryPanel(mode) {
    clearTimeout(historyHideTimer);
    const panel = dom.historyPanel;
    if (!panel) return;
    panel.innerHTML = "";
    panel.dataset.mode = mode;

    let list = mode === "undo" ? history.getUndoList() : history.getRedoList();
    if (mode === "redo") {
      list = list.slice().reverse();
    }

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent =
        mode === "undo"
          ? "تغییری برای بازگشت نیست"
          : "تغییری برای انجام مجدد نیست";
      panel.appendChild(empty);
    } else {
      const rows = [];
      list.forEach((item, displayIdx) => {
        const entry = document.createElement("div");
        entry.className = "history-entry";

        const row = document.createElement("div");
        row.className = "history-item";
        row.tabIndex = 0;
        row.setAttribute("role", "option");
        row.dataset.displayIdx = String(displayIdx);
        row.dataset.targetIndex = String(item.index);

        const label = document.createElement("span");
        label.className = "history-item-label";
        label.textContent = item.label;
        const time = document.createElement("span");
        time.className = "history-item-time";
        time.textContent = formatRelTime(item.timestamp);
        row.appendChild(label);
        row.appendChild(time);

        if (hasSemanticDiff(item.before, item.after)) {
          const diffBtn = document.createElement("button");
          diffBtn.className = "history-item-diff";
          diffBtn.title = "مقایسه قبل و بعد";
          diffBtn.innerHTML =
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
          diffBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            showDiffModal(item.label, item.before, item.after);
          });
          entry.appendChild(diffBtn);
        }

        row.addEventListener("mouseenter", () => {
          if (mode === "undo") {
            rows.forEach((r, i) => {
              r.classList.toggle("history-preview", i <= displayIdx);
            });
          } else {
            rows.forEach((r, i) => {
              r.classList.toggle("history-preview", i >= displayIdx);
            });
          }
        });

        row.addEventListener("click", () => {
          const nodes = history.jumpTo(item.index);
          if (nodes) {
            window.__applyHistoryState?.(nodes);
            panel.classList.add("hidden");
          }
        });

        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            row.click();
          }
        });

        entry.appendChild(row);
        panel.appendChild(entry);
        rows.push(row);
      });
    }
    panel.classList.remove("hidden");
  }

  /**
   * Schedules the history panel hide, cleaning preview classes and the
   * submenu highlights, and collapsing the toolbar when the pointer is
   * no longer over it.
   *
   * @returns {void}
   */
  function scheduleHideHistory() {
    historyHideTimer = setTimeout(() => {
      if (dom.historyPanel) {
        dom.historyPanel.classList.add("hidden");
        dom.historyPanel
          .querySelectorAll(".history-preview")
          .forEach((el) => el.classList.remove("history-preview"));
      }
      document
        .querySelectorAll("#tool-undo, #tool-redo")
        .forEach((el) => el.classList.remove("submenu-open"));
      const tools = document.querySelector(".tools");
      if (
        tools &&
        !tools.matches(":hover") &&
        !dom.moreMenu?.matches(":hover")
      ) {
        tools.classList.remove("is-expanded");
      }
    }, HIDE_DELAY);
  }

  /* ---------------------------------------------------------- *
   * More menu
   * ---------------------------------------------------------- */

  const moreBtn = document.getElementById("tool-more");

  /**
   * Opens the "more" menu flush to the left of its button, clamped into
   * the viewport.
   *
   * @returns {void}
   */
  function openMoreMenu() {
    if (!moreBtn || !dom.moreMenu) return;
    clearSubmenuOpenClass();
    moreBtn.classList.add("submenu-open");
    setToolsExpanded(true);
    if (dom.historyPanel) dom.historyPanel.classList.add("hidden");

    const menu = dom.moreMenu;
    menu.classList.remove("hidden");
    const btnRect = moreBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = btnRect.left - menuRect.width - 10;
    let top = btnRect.top;
    if (left < 10) left = 10;
    if (top + menuRect.height > window.innerHeight - 10) {
      top = Math.max(10, window.innerHeight - menuRect.height - 10);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.zIndex = "1100";
  }

  /**
   * Closes the "more" menu and collapses the toolbar when neither it nor
   * the history panel keeps it pinned open.
   *
   * @returns {void}
   */
  function closeMoreMenu() {
    if (dom.moreMenu) dom.moreMenu.classList.add("hidden");
    moreBtn?.classList.remove("submenu-open");
    if (!dom.historyPanel || dom.historyPanel.classList.contains("hidden")) {
      if (!toolsEl?.matches(":hover")) setToolsExpanded(false);
    }
  }

  /* ---------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------- */

  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    actions.undo();
    if (dom.historyPanel) dom.historyPanel.classList.add("hidden");
  });
  redoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    actions.redo();
    if (dom.historyPanel) dom.historyPanel.classList.add("hidden");
  });

  if (toolsEl) {
    toolsEl.addEventListener("mouseleave", (e) => {
      const ae = document.activeElement;
      if (ae && ae.classList?.contains("tool-btn")) ae.blur();
      const to = e.relatedTarget;
      if (
        to &&
        (dom.historyPanel?.contains(to) || dom.moreMenu?.contains(to))
      ) {
        return;
      }
      if (dom.historyPanel && !dom.historyPanel.classList.contains("hidden"))
        return;
      if (dom.moreMenu && !dom.moreMenu.classList.contains("hidden")) return;
      toolsEl.classList.remove("is-expanded");
    });
  }

  undoBtn.addEventListener("mouseenter", () => {
    if (undoBtn.disabled || !history.canUndo()) return;
    clearTimeout(historyHideTimer);
    cancelHistoryOpen();
    cancelMoreOpen();
    if (dom.moreMenu) dom.moreMenu.classList.add("hidden");
    historyOpenTimer = setTimeout(() => {
      historyOpenTimer = null;
      if (undoBtn.disabled || !history.canUndo()) return;
      clearSubmenuOpenClass();
      undoBtn.classList.add("submenu-open");
      setToolsExpanded(true);
      showHistoryPanel("undo");
    }, SUBMENU_DELAY);
  });
  undoBtn.addEventListener("mouseleave", () => {
    cancelHistoryOpen();
  });

  redoBtn.addEventListener("mouseenter", () => {
    if (redoBtn.disabled || !history.canRedo()) return;
    clearTimeout(historyHideTimer);
    cancelHistoryOpen();
    cancelMoreOpen();
    if (dom.moreMenu) dom.moreMenu.classList.add("hidden");
    historyOpenTimer = setTimeout(() => {
      historyOpenTimer = null;
      if (redoBtn.disabled || !history.canRedo()) return;
      clearSubmenuOpenClass();
      redoBtn.classList.add("submenu-open");
      setToolsExpanded(true);
      showHistoryPanel("redo");
    }, SUBMENU_DELAY);
  });
  redoBtn.addEventListener("mouseleave", () => {
    cancelHistoryOpen();
  });

  undoGroup.addEventListener("mouseleave", (e) => {
    const to = e.relatedTarget;
    if (to && (dom.historyPanel?.contains(to) || undoGroup.contains(to)))
      return;
    cancelHistoryOpen();
    scheduleHideHistory();
  });

  if (dom.historyPanel) {
    dom.historyPanel.addEventListener("mouseenter", () => {
      clearTimeout(historyHideTimer);
      setToolsExpanded(true);
    });
    dom.historyPanel.addEventListener("mouseleave", (e) => {
      const to = e.relatedTarget;
      if (to && (toolsEl?.contains(to) || undoGroup.contains(to))) return;
      scheduleHideHistory();
    });
  }

  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });

  moreBtn.addEventListener("mouseenter", () => {
    cancelMoreOpen();
    cancelHistoryOpen();
    clearTimeout(historyHideTimer);
    if (dom.historyPanel) dom.historyPanel.classList.add("hidden");
    moreOpenTimer = setTimeout(() => {
      moreOpenTimer = null;
      openMoreMenu();
    }, SUBMENU_DELAY);
  });

  moreBtn.addEventListener("mouseleave", (e) => {
    cancelMoreOpen();
    const to = e.relatedTarget;
    if (to && dom.moreMenu?.contains(to)) return;
    setTimeout(() => {
      if (
        dom.moreMenu &&
        !dom.moreMenu.matches(":hover") &&
        !moreBtn.matches(":hover")
      ) {
        closeMoreMenu();
      }
    }, 200);
  });

  if (dom.moreMenu) {
    dom.moreMenu.addEventListener("mouseenter", () => {
      setToolsExpanded(true);
    });
    dom.moreMenu.addEventListener("mouseleave", (e) => {
      const to = e.relatedTarget;
      if (to && (moreBtn.contains(to) || toolsEl?.contains(to))) return;
      closeMoreMenu();
    });
  }

  document.querySelectorAll("#more-menu .menu-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      if (action === "dark-mode") actions.toggleDarkMode();
      if (action === "export") actions.exportData();
      if (action === "import") dom.fileImport.click();
      dom.moreMenu.classList.add("hidden");
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        item.click();
      }
    });
  });

  /* ---------------------------------------------------------- *
   * Done-task filter control
   * ---------------------------------------------------------- */

  const filterBtn = document.getElementById("tool-filter-active");

  if (filterBtn) {
    if (localStorage.getItem("filterActive") === "true") {
      document.body.classList.add("filter-active");
    }
    syncFilterUI();
    filterBtn.addEventListener("click", () => {
      toggleFilter();
      actions.autoArrange();
    });
  }
}
