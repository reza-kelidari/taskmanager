/**
 * @module events
 * @description Remaining global wiring: top-level toolbar buttons, the
 * notes/confirm dialogs, the node input modal, the task details modal,
 * the search input, toast hover-pause, canvas panning and JSON import.
 * Also bootstraps the focused sub-modules (toolbar menus, context menus,
 * keyboard shortcuts, diff modal).
 */
import { state } from "./state.js";
import { dom, positionFloating } from "./dom.js";
import { removeToast } from "./utils.js";
import { deleteNodeDB, saveNode } from "./db.js";
import { history } from "./history.js";
import { drawConnections } from "./connections.js";
import { showSearchModal, debouncedSearch } from "./search.js";
import { showNotesMenu, openNoteModal, saveNote } from "./notes.js";
import { saveInput } from "./modals.js";
import { setupToolbarMenus } from "./toolbar-menus.js";
import { setupContextMenus } from "./context-menus.js";
import { setupKeyboardShortcuts } from "./keyboard.js";
import { setupDiffModal } from "./diff.js";
import { setupDetailsModal } from "./details.js";
import { setupMoveMenu } from "./move.js";
import {
  setupPages,
  renderPageTabs,
  setActivePage,
  saveActiveView,
  DEFAULT_CONFIRM_TEXT,
} from "./pages.js";
import { savePage } from "./db.js";

/**
 * @typedef {object} AppActions
 * @property {Function} renderNodes    Re-renders all nodes.
 * @property {Function} autoArrange    Runs the automatic layout.
 * @property {Function} undo           Steps one entry back in history.
 * @property {Function} redo           Steps one entry forward in history.
 * @property {Function} toggleDarkMode Toggles dark mode.
 * @property {Function} exportData     Exports the graph as JSON.
 */

/**
 * Wires every global event listener once, delegating domain-specific
 * wiring to the focused sub-modules.
 *
 * @param {AppActions} actions Application callbacks.
 * @returns {void}
 */
export function setupEvents(actions) {
  document
    .getElementById("tool-arrange")
    .addEventListener("click", actions.autoArrange);
  document
    .getElementById("tool-search")
    .addEventListener("click", showSearchModal);

  setupToolbarMenus(actions);
  setupContextMenus(actions);
  setupKeyboardShortcuts(actions);
  setupDiffModal();
  setupDetailsModal();
  setupMoveMenu();
  setupPages();

  /* Notes menu / confirm dialog wiring */

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
      actions.renderNodes();
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
    document.getElementById("confirm-text").textContent = DEFAULT_CONFIRM_TEXT;
    state.pendingDeleteAction = null;
    if (state.currentNoteNodeId) {
      const node = state.nodes.find((n) => n.id == state.currentNoteNodeId);
      let x = parseInt(dom.confirmModal.style.left);
      let y = parseInt(dom.confirmModal.style.top);
      if (!Number.isFinite(x)) x = window.innerWidth / 2 - 125;
      if (!Number.isFinite(y)) y = window.innerHeight / 2 - 100;
      if (node) showNotesMenu(x, y, node);
    }
  });

  /* Search input */

  dom.searchInput.addEventListener("input", debouncedSearch);

  /* Toast hover-pause (freeze lifetimes while reading) */

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

  /* Canvas panning (drag on empty canvas) */

  document
    .getElementById("canvas-wrapper")
    .addEventListener("mousedown", (e) => {
      if (
        e.target.closest(".node") ||
        e.target.closest(".connection-point") ||
        e.target.closest(".thread-hit")
      )
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

  /* JSON import */

  dom.fileImport.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file, actions.renderNodes);
      e.target.value = "";
    }
  });
}

/**
 * Moves the canvas with the pointer during an active pan session.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
function handlePan(e) {
  if (!state.panData) return;
  dom.canvas.style.left = `${state.panData.initLeft + (e.clientX - state.panData.startX)}px`;
  dom.canvas.style.top = `${state.panData.initTop + (e.clientY - state.panData.startY)}px`;
}

/**
 * Ends the pan session and persists the canvas offset.
 *
 * @returns {void}
 */
function endPan() {
  localStorage.setItem("canvasX", parseInt(dom.canvas.style.left) || 0);
  localStorage.setItem("canvasY", parseInt(dom.canvas.style.top) || 0);
  saveActiveView(dom.canvas.style.left, dom.canvas.style.top);
  state.panData = null;
  document.removeEventListener("mousemove", handlePan);
  document.removeEventListener("mouseup", endPan);
}

/**
 * Imports a JSON export: replaces the whole graph, normalizing notes and
 * the multi-input shape (promoting the first extra parent of any node
 * without a primary parent). Version-3 payloads carry pages (version-2
 * used `boards`, accepted as legacy); nodes without a known page fall
 * back to the first one. Older payloads get a single fresh page.
 *
 * @param {File} file Selected JSON file.
 * @param {Function} renderNodesFn Render callback.
 * @returns {void}
 */
function importData(file, renderNodesFn) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.nodes || !Array.isArray(data.nodes))
        throw new Error("Invalid file format");
      state.nodes.forEach((n) => deleteNodeDB(n.id));
      const importedPages = (
        Array.isArray(data.pages)
          ? data.pages
          : Array.isArray(data.boards)
            ? data.boards
            : []
      ).filter((b) => b && b.id);
      if (importedPages.length === 0) {
        importedPages.push({
          id:
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
              ? crypto.randomUUID()
              : String(Date.now()),
          title: "صفحه ۱",
          createdAt: Date.now(),
        });
      }
      state.pages = importedPages;
      const byId = new Map(importedPages.map((b) => [String(b.id), b]));
      const firstId = importedPages[0].id;
      importedPages.forEach((b) => savePage(b));
      state.nodes = data.nodes.map((node) => {
        const { boardId: _legacy, ...rest } = node;
        const pageId =
          rest.pageId != null && byId.has(String(rest.pageId))
            ? rest.pageId
            : _legacy != null && byId.has(String(_legacy))
              ? _legacy
              : firstId;
        return {
          ...rest,
          notes: rest.notes || [],
          extraParents: Array.isArray(rest.extraParents)
            ? rest.extraParents
            : [],
          pageId,
        };
      });
      state.nodes.forEach((n) => {
        if (n.parent == null && n.extraParents.length > 0) {
          n.parent = n.extraParents.shift();
        }
      });
      state.nodes.forEach((n) => saveNode(n));
      history.push(state.nodes, "ورود داده");
      setActivePage(firstId);
    } catch (error) {
      console.error("Import failed:", error);
    }
  };
  reader.readAsText(file);
}
