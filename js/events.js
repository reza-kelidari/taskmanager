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
    state.pendingDeleteAction = null;
    if (state.currentNoteNodeId) {
      const node = state.nodes.find((n) => n.id == state.currentNoteNodeId);
      const x = parseInt(dom.confirmModal.style.left);
      const y = parseInt(dom.confirmModal.style.top);
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
  state.panData = null;
  document.removeEventListener("mousemove", handlePan);
  document.removeEventListener("mouseup", endPan);
}

/**
 * Imports a JSON export: replaces the whole graph, normalizing notes and
 * the multi-input shape (promoting the first extra parent of any node
 * without a primary parent).
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
      state.nodes = data.nodes.map((node) => ({
        ...node,
        notes: node.notes || [],
        extraParents: Array.isArray(node.extraParents) ? node.extraParents : [],
      }));
      state.nodes.forEach((n) => {
        if (n.parent == null && n.extraParents.length > 0) {
          n.parent = n.extraParents.shift();
        }
      });
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
