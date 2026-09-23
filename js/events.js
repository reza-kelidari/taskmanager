import { state } from "./state.js";
import { dom, hideAllMenus, hideAllModals, positionFloating } from "./dom.js";
import { history } from "./history.js";
import { saveNode, deleteNodeDB, setNodeDoneStatus } from "./db.js";
import { drawConnections } from "./drag.js";
import { showSearchModal, debouncedSearch } from "./search.js";
import { showNotesMenu, openNoteModal, saveNote } from "./notes.js";
import { showInputModal, saveInput } from "./modals.js";

export function setupEvents(
  renderNodesFn,
  autoArrangeFn,
  undoFn,
  redoFn,
  toggleDarkModeFn,
  exportDataFn,
) {
  document
    .getElementById("tool-arrange")
    .addEventListener("click", autoArrangeFn);
  document
    .getElementById("tool-search")
    .addEventListener("click", showSearchModal);

  // Undo / Redo with history panel on hover
  const undoBtn = document.getElementById("tool-undo");
  const redoBtn = document.getElementById("tool-redo");
  const undoGroup = document.getElementById("undo-group");

  // Click on buttons = single step only
  undoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    undoFn();
    if (dom.historyPanel) dom.historyPanel.classList.add("hidden");
  });
  redoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    redoFn();
    if (dom.historyPanel) dom.historyPanel.classList.add("hidden");
  });

  // Blur tool buttons when mouse leaves toolbar so labels don't stick
  const toolsEl = document.querySelector(".tools");
  if (toolsEl) {
    toolsEl.addEventListener("mouseleave", (e) => {
      const ae = document.activeElement;
      if (ae && ae.classList?.contains("tool-btn")) ae.blur();
      const to = e.relatedTarget;
      // keep expanded while moving into floating submenus
      if (
        to &&
        (dom.historyPanel?.contains(to) || dom.moreMenu?.contains(to))
      ) {
        return;
      }
      // if a submenu is open, leave is-expanded until submenu closes
      if (dom.historyPanel && !dom.historyPanel.classList.contains("hidden"))
        return;
      if (dom.moreMenu && !dom.moreMenu.classList.contains("hidden")) return;
      toolsEl.classList.remove("is-expanded");
    });
  }

  let historyHideTimer = null;
  let currentHistoryMode = null;

  function showHistoryPanel(mode) {
    clearTimeout(historyHideTimer);
    currentHistoryMode = mode;
    const panel = dom.historyPanel;
    if (!panel) return;
    panel.innerHTML = "";
    panel.dataset.mode = mode;

    // undo: most recent first (top)
    // redo: furthest first (top), closest at bottom
    let list = mode === "undo" ? history.getUndoList() : history.getRedoList();
    if (mode === "redo") {
      // getRedoList is near→far; reverse so far is top, near is bottom
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
        // wrapper: دکمه «...» بیرون از خود ردیف قرار می‌گیرد
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

        // دکمه «...» فقط برای تغییرات محتوایی (نه جابجایی/چینش)
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

        // Progressive preview selection
        row.addEventListener("mouseenter", () => {
          if (mode === "undo") {
            // dim from top (0) through this index
            rows.forEach((r, i) => {
              r.classList.toggle("history-preview", i <= displayIdx);
            });
          } else {
            // redo: selection grows from bottom upward
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

        // پشتیبانی کیبورد (Enter/Space)
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

  function scheduleHideHistory() {
    historyHideTimer = setTimeout(() => {
      if (dom.historyPanel) {
        dom.historyPanel.classList.add("hidden");
        dom.historyPanel
          .querySelectorAll(".history-preview")
          .forEach((el) => el.classList.remove("history-preview"));
      }
      currentHistoryMode = null;
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
    }, 280);
  }

  const SUBMENU_DELAY = 500;
  let historyOpenTimer = null;
  let moreOpenTimer = null;

  function setToolsExpanded(on) {
    if (toolsEl) toolsEl.classList.toggle("is-expanded", !!on);
  }

  function cancelHistoryOpen() {
    if (historyOpenTimer) {
      clearTimeout(historyOpenTimer);
      historyOpenTimer = null;
    }
  }

  function cancelMoreOpen() {
    if (moreOpenTimer) {
      clearTimeout(moreOpenTimer);
      moreOpenTimer = null;
    }
  }

  function clearSubmenuOpenClass() {
    document
      .querySelectorAll(".tool-btn.submenu-open")
      .forEach((el) => el.classList.remove("submenu-open"));
  }

  function closeAllSubmenus() {
    cancelHistoryOpen();
    cancelMoreOpen();
    clearTimeout(historyHideTimer);
    if (dom.historyPanel) {
      dom.historyPanel.classList.add("hidden");
      dom.historyPanel
        .querySelectorAll(".history-preview")
        .forEach((el) => el.classList.remove("history-preview"));
    }
    if (dom.moreMenu) dom.moreMenu.classList.add("hidden");
    clearSubmenuOpenClass();
    setToolsExpanded(false);
  }

  // Show undo list when hovering undo button (0.5s delay) — only if enabled
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

  // Show redo list when hovering redo button (0.5s delay) — only if enabled
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
    // if moving into history panel, keep open
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

  // ✅ فیلتر «نمایش / عدم نمایش انجام‌شده‌ها» — برچسب، دایره و title
  // با وضعیت هماهنگ می‌شوند (دکمه و میانبر Ctrl+D هر دو toggleFilter را صدا می‌زنند)
  const filterBtn = document.getElementById("tool-filter-active");

  function syncFilterUI() {
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

  function toggleFilter() {
    document.body.classList.toggle("filter-active");
    localStorage.setItem(
      "filterActive",
      document.body.classList.contains("filter-active"),
    );
    syncFilterUI();
    autoArrangeFn();
  }

  if (filterBtn) {
    if (localStorage.getItem("filterActive") === "true") {
      document.body.classList.add("filter-active");
    }
    syncFilterUI();
    filterBtn.addEventListener("click", toggleFilter);
  }

  // Diff modal close
  document.getElementById("diff-close")?.addEventListener("click", () => {
    dom.diffModal?.classList.add("hidden");
  });

  const moreBtn = document.getElementById("tool-more");

  function openMoreMenu() {
    if (!moreBtn || !dom.moreMenu) return;
    clearSubmenuOpenClass();
    moreBtn.classList.add("submenu-open");
    setToolsExpanded(true);
    if (dom.historyPanel) dom.historyPanel.classList.add("hidden");

    const menu = dom.moreMenu;
    menu.classList.remove("hidden");
    // measure after showing to place flush left of the button (like history panel)
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

  function closeMoreMenu() {
    if (dom.moreMenu) dom.moreMenu.classList.add("hidden");
    moreBtn?.classList.remove("submenu-open");
    if (!dom.historyPanel || dom.historyPanel.classList.contains("hidden")) {
      if (!toolsEl?.matches(":hover")) setToolsExpanded(false);
    }
  }

  // فقط با هاور (تأخیر ۰.۵ث) — بدون باز شدن فوری با کلیک
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
      if (action === "dark-mode") toggleDarkModeFn();
      if (action === "export") exportDataFn();
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

  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    hideAllMenus();
    hideAllModals();

    const nodeEl = e.target.closest(".node");

    if (nodeEl) {
      state.activeEl = nodeEl;
      const nodeData = state.nodes.find((n) => n.id == nodeEl.dataset.id);
      if (!nodeData) return;
      const toggleItem = dom.elementMenu.querySelector(
        '[data-action="toggle-done"]',
      );
      const notesItem = dom.elementMenu.querySelector(
        '[data-action="comments"]',
      );
      if (nodeData.type === "task") {
        toggleItem.style.display = "flex";
        toggleItem.innerText = nodeData.done ? "انجام نشده" : "انجام شده";
        notesItem.style.display = "flex";
        notesItem.innerText = "یادداشت‌ها";
      } else {
        toggleItem.style.display = "none";
        notesItem.style.display = "none";
      }
      positionFloating(dom.elementMenu, e.clientX, e.clientY);
    } else if (e.target.closest("#canvas-wrapper")) {
      state.activeEl = null;
      const taskItem = dom.contextMenu.querySelector(
        '[data-action="new-task"]',
      );
      taskItem.classList.toggle(
        "disabled",
        !state.nodes.some((n) => n.type === "header"),
      );
      positionFloating(dom.contextMenu, e.clientX, e.clientY);
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (
      !e.target.closest(".context-menu") &&
      !e.target.closest(".history-panel") &&
      !e.target.closest(".modal-content") &&
      !e.target.closest("#tool-more")
    ) {
      hideAllMenus();
      hideAllModals();
      state.editingNodeId = null;
    }
  });

  document
    .querySelectorAll(".context-menu .menu-item[data-action]")
    .forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (item.classList.contains("disabled")) return;
        const action = item.dataset.action;
        const menu = item.closest(".context-menu");
        const x = parseInt(menu.style.left);
        const y = parseInt(menu.style.top);

        if (menu.id === "context-menu") {
          if (action === "new-header") showInputModal("header", x, y);
          if (action === "new-task") showInputModal("task", x, y);
          hideAllMenus();
        } else if (menu.id === "element-menu") {
          const nodeId = state.activeEl.dataset.id;
          const node = state.nodes.find((n) => n.id == nodeId);
          if (action === "edit") {
            showInputModal(node.type, x, y, node);
            hideAllMenus();
          }
          if (action === "delete") {
            const parentId = node.parent;
            state.nodes
              .filter((n) => n.parent == nodeId)
              .forEach((child) => {
                child.parent = parentId;
                saveNode(child);
              });
            state.nodes = state.nodes.filter((n) => n.id != nodeId);
            deleteNodeDB(nodeId);
            history.push(state.nodes, `حذف «${node.title}»`);
            renderNodesFn();
            drawConnections();
            hideAllMenus();
          }
          if (action === "toggle-done") {
            setNodeDoneStatus(node, !node.done);
            history.push(
              state.nodes,
              node.done
                ? `انجام‌شده «${node.title}»`
                : `لغو انجام «${node.title}»`,
            );
            renderNodesFn();
            autoArrangeFn();
            hideAllMenus();
          }
          if (action === "comments") {
            state.currentNoteNodeId = nodeId;
            showNotesMenu(x, y, node);
            dom.elementMenu.classList.add("hidden");
          }
        }
      });
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          item.click();
        }
      });
    });

  document.getElementById("back-from-notes").addEventListener("click", (e) => {
    e.stopPropagation();
    const x = parseInt(dom.notesMenu.style.left);
    const y = parseInt(dom.notesMenu.style.top);
    dom.notesMenu.classList.add("hidden");
    if (state.activeEl) positionFloating(dom.elementMenu, x, y);
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    const result = saveInput();
    if (result) {
      renderNodesFn();
      drawConnections();
    }
  });

  document
    .getElementById("add-note-btn")
    .addEventListener("click", () => openNoteModal(false, -1, ""));
  document.getElementById("save-note-btn").addEventListener("click", () => {
    saveNote();
  });

  document.getElementById("confirm-yes").addEventListener("click", () => {
    if (state.pendingDeleteAction) {
      state.pendingDeleteAction();
    }
  });
  document.getElementById("confirm-no").addEventListener("click", () => {
    dom.confirmModal.classList.add("hidden");
    state.pendingDeleteAction = null;
    if (state.currentNoteNodeId) {
      const node = state.nodes.find((n) => n.id == state.currentNoteNodeId);
      const x = parseInt(dom.confirmModal.style.left);
      const y = parseInt(dom.confirmModal.style.top);
      if (node) showNotesMenu(x, y, node);
    }
  });

  // ✅ میانبرهای کیبورد — کلیدها با toLowerCase مقایسه می‌شوند
  // (با Shift، e.key حرف بزرگ می‌شود و بدون این، Ctrl+Shift+Z کار نمی‌کرد)
  document.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    const isEditable =
      e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";

    // Undo: Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
      e.preventDefault();
      undoFn();
      return;
    }
    // Redo: Ctrl+Shift+Z (Ctrl+Y هم به عنوان میانبر جایگزین باقی است)
    if (
      (e.ctrlKey || e.metaKey) &&
      (key === "y" || (key === "z" && e.shiftKey))
    ) {
      e.preventDefault();
      redoFn();
      return;
    }
    // چینش: Ctrl+A — داخل فیلدهای متنی، Ctrl+A همان select-all بماند
    if ((e.ctrlKey || e.metaKey) && key === "a" && !isEditable) {
      e.preventDefault();
      autoArrangeFn();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "f") {
      e.preventDefault();
      showSearchModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "e") {
      e.preventDefault();
      exportDataFn();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "i") {
      e.preventDefault();
      dom.fileImport.click();
      return;
    }
    // ✅ فیلتر نمایش/عدم نمایش انجام‌شده‌ها: Ctrl+D
    if ((e.ctrlKey || e.metaKey) && key === "d") {
      e.preventDefault();
      toggleFilter();
      return;
    }
    if (e.key === "Escape") {
      hideAllMenus();
      hideAllModals();
      state.editingNodeId = null;
      return;
    }
    if (e.key === "Enter" && !dom.inputModal.classList.contains("hidden")) {
      if (e.target.tagName !== "TEXTAREA" || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        document.getElementById("btn-save").click();
      }
    } else if (
      e.key === "Enter" &&
      !dom.noteModal.classList.contains("hidden")
    ) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        document.getElementById("save-note-btn").click();
      }
    } else if (
      e.key === "Enter" &&
      !dom.searchModal.classList.contains("hidden")
    ) {
      e.preventDefault();
      const firstResult = dom.searchResults.querySelector(
        ".search-result-item",
      );
      if (firstResult) firstResult.click();
    }
  });

  dom.searchInput.addEventListener("input", debouncedSearch);

  dom.toastContainer.addEventListener("mouseenter", () => {
    state.isToastPaused = true;
    state.toastTimers.forEach((t) => {
      clearTimeout(t.timerId);
      t.remaining -= Date.now() - t.startTime;
      if (t.remaining < 0) t.remaining = 0;
    });
  });
  dom.toastContainer.addEventListener("mouseleave", () => {
    state.isToastPaused = false;
    state.toastTimers.forEach((t) => {
      t.startTime = Date.now();
      t.timerId = setTimeout(() => removeToast(t.element), t.remaining);
    });
  });

  document
    .getElementById("canvas-wrapper")
    .addEventListener("mousedown", (e) => {
      if (e.target.closest(".node") || e.target.closest(".connection-point"))
        return;
      state.panData = {
        startX: e.clientX,
        startY: e.clientY,
        initLeft: parseInt(dom.canvas.style.left || 0),
        initTop: parseInt(dom.canvas.style.top || 0),
      };
      document.addEventListener("mousemove", handlePan);
      document.addEventListener("mouseup", endPan);
    });

  dom.fileImport.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file, renderNodesFn);
      e.target.value = "";
    }
  });
}

function handlePan(e) {
  if (!state.panData) return;
  dom.canvas.style.left = `${state.panData.initLeft + (e.clientX - state.panData.startX)}px`;
  dom.canvas.style.top = `${state.panData.initTop + (e.clientY - state.panData.startY)}px`;
}

function endPan() {
  localStorage.setItem("canvasX", parseInt(dom.canvas.style.left) || 0);
  localStorage.setItem("canvasY", parseInt(dom.canvas.style.top) || 0);
  state.panData = null;
  document.removeEventListener("mousemove", handlePan);
  document.removeEventListener("mouseup", endPan);
}

function importData(file, renderNodesFn) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.nodes || !Array.isArray(data.nodes))
        throw new Error("Invalid file format");
      state.nodes.forEach((n) => deleteNodeDB(n.id));
      state.nodes = data.nodes.map((node) => ({
        ...node,
        notes: node.notes || [],
      }));
      state.nodes.forEach((n) => saveNode(n));
      history.push(state.nodes, "ورود داده");
      renderNodesFn();
      drawConnections();
    } catch (error) {
      console.error("Import failed:", error);
    }
  };
  reader.readAsText(file);
}

function removeToast(toastEl) {
  if (!toastEl || !toastEl.parentNode) return;
  const timerObj = toastEl._timerObj;
  if (timerObj) {
    clearTimeout(timerObj.timerId);
    const idx = state.toastTimers.indexOf(timerObj);
    if (idx > -1) state.toastTimers.splice(idx, 1);
  }
  toastEl.classList.add("toast-exit");
  setTimeout(() => {
    if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
  }, 300);
}

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

// ============================================================
// Diff — محاسبه و نمایش دقیق تغییرات بین دو وضعیت
// ============================================================

function nodeLabel(n) {
  const type = n?.type === "header" ? "سرفصل" : "وظیفه";
  return `${type} «${n?.title ?? "؟"}»`;
}

function parentTitle(nodesArr, parentId) {
  if (!parentId) return "بدون والد";
  const p = (nodesArr || []).find((n) => String(n.id) === String(parentId));
  return p ? p.title : "؟";
}

function noteText(n) {
  if (n == null) return "";
  if (typeof n === "object") return String(n.text ?? "");
  return String(n);
}

function diffNotes(beforeNotes, afterNotes) {
  const b = Array.isArray(beforeNotes) ? beforeNotes : [];
  const a = Array.isArray(afterNotes) ? afterNotes : [];
  const out = [];

  if (b.length === a.length) {
    // تعداد برابر: یا تغییری نیست یا متنی ویرایش شده
    for (let i = 0; i < a.length; i++) {
      if (noteText(b[i]) !== noteText(a[i])) {
        out.push({
          kind: "edited",
          oldText: noteText(b[i]),
          newText: noteText(a[i]),
        });
      }
    }
    return out;
  }

  // تعداد متفاوت: یادداشتی اضافه یا حذف شده
  const beforeTexts = b.map(noteText);
  const afterTexts = a.map(noteText);
  const afterSet = new Set(afterTexts);
  const beforeSet = new Set(beforeTexts);
  beforeTexts.forEach((t) => {
    if (!afterSet.has(t)) out.push({ kind: "removed", text: t });
  });
  afterTexts.forEach((t) => {
    if (!beforeSet.has(t)) out.push({ kind: "added", text: t });
  });
  return out;
}

/**
 * تغییرات معنادار بین دو وضعیت:
 * افزودن/حذف نود، تغییر عنوان، وضعیت انجام، والد (اتصال)، و یادداشت‌ها.
 * فقط جابجایی (x/y) حساب نمی‌شود.
 */
function computeDiff(beforeArr, afterArr) {
  const before = beforeArr || [];
  const after = afterArr || [];
  const changes = [];
  const beforeMap = new Map(before.map((n) => [n.id, n]));
  const afterMap = new Map(after.map((n) => [n.id, n]));

  for (const a of after) {
    if (!beforeMap.has(a.id)) changes.push({ kind: "add", node: a });
  }
  for (const b of before) {
    if (!afterMap.has(b.id)) changes.push({ kind: "remove", node: b });
  }
  for (const b of before) {
    const a = afterMap.get(b.id);
    if (!a) continue;

    if ((b.title || "") !== (a.title || "")) {
      changes.push({ kind: "title", node: a, oldTitle: b.title || "" });
    }
    if (!!b.done !== !!a.done) {
      changes.push({ kind: "done", node: a, done: !!a.done });
    }
    if (String(b.parent ?? "") !== String(a.parent ?? "")) {
      changes.push({
        kind: "parent",
        node: a,
        oldParent: b.parent ?? null,
        newParent: a.parent ?? null,
      });
    }
    for (const nc of diffNotes(b.notes, a.notes)) {
      changes.push({ kind: "note", node: a, note: nc });
    }
  }
  return changes;
}

function hasSemanticDiff(before, after) {
  return computeDiff(before, after).length > 0;
}

/** دو ستون هم‌ترازِ «قبل» و «بعد» — هر تغییر یک خط در هر ستون */
function diffToTexts(before, after) {
  const changes = computeDiff(before, after);
  const beforeLines = [];
  const afterLines = [];

  changes.forEach((c) => {
    const name = nodeLabel(c.node);
    switch (c.kind) {
      case "add":
        beforeLines.push("—");
        afterLines.push(`${name}${c.node.done ? " ✓" : ""} (اضافه شد)`);
        break;
      case "remove":
        beforeLines.push(`${name} (حذف شد)`);
        afterLines.push("—");
        break;
      case "title":
        beforeLines.push(`عنوانِ ${name}:\n«${c.oldTitle}»`);
        afterLines.push(`عنوانِ ${name}:\n«${c.node.title}»`);
        break;
      case "done":
        beforeLines.push(
          `${c.node.title}: ${c.done ? "انجام‌نشده" : "انجام‌شده ✓"}`,
        );
        afterLines.push(
          `${c.node.title}: ${c.done ? "انجام‌شده ✓" : "انجام‌نشده"}`,
        );
        break;
      case "parent":
        beforeLines.push(
          `والدِ ${name}: «${parentTitle(before, c.oldParent)}»`,
        );
        afterLines.push(`والدِ ${name}: «${parentTitle(after, c.newParent)}»`);
        break;
      case "note": {
        const n = c.note;
        if (n.kind === "edited") {
          beforeLines.push(`یادداشتِ ${name}:\n«${n.oldText || "(خالی)"}»`);
          afterLines.push(`یادداشتِ ${name}:\n«${n.newText || "(خالی)"}»`);
        } else if (n.kind === "added") {
          beforeLines.push("—");
          afterLines.push(`یادداشتِ ${name}:\n«${n.text || "(خالی)"}»`);
        } else {
          beforeLines.push(`یادداشتِ ${name}:\n«${n.text || "(خالی)"}»`);
          afterLines.push("—");
        }
        break;
      }
    }
  });

  if (beforeLines.length === 0) {
    return {
      before: "(تغییر محتوایی نبوده — فقط جابجایی/چینش)",
      after: "(تغییر محتوایی نبوده — فقط جابجایی/چینش)",
    };
  }
  return { before: beforeLines.join("\n"), after: afterLines.join("\n") };
}

function showDiffModal(label, before, after) {
  if (!dom.diffModal) return;
  document.getElementById("diff-label").textContent = label || "مقایسه";
  const { before: beforeText, after: afterText } = diffToTexts(before, after);
  document.getElementById("diff-before").textContent = beforeText;
  document.getElementById("diff-after").textContent = afterText;
  dom.diffModal.classList.remove("hidden");
}
