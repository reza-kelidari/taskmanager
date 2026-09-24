/**
 * @module keyboard
 * @description Global keyboard shortcuts and modal key handling.
 *
 * Shortcuts:
 * - Ctrl/Cmd+Z          → undo
 * - Ctrl/Cmd+Shift+Z    → redo (Ctrl/Cmd+Y kept as an alias)
 * - Ctrl/Cmd+A          → auto-arrange (select-all preserved inside text
 *                         fields)
 * - Ctrl/Cmd+F          → search
 * - Ctrl/Cmd+E          → export JSON
 * - Ctrl/Cmd+I          → import JSON
 * - Ctrl/Cmd+D          → toggle the done-task filter
 * - Escape              → dismiss menus/modals
 * - Enter               → confirm the open modal (Ctrl+Enter inside
 *                         textareas)
 */
import { dom, hideAllMenus, hideAllModals } from "./dom.js";
import { state } from "./state.js";
import { showSearchModal } from "./search.js";
import { openPagesModal } from "./pages.js";
import { toggleFilter } from "./toolbar-menus.js";

/**
 * @typedef {object} AppActions
 * @property {Function} undo        Steps one entry back in history.
 * @property {Function} redo        Steps one entry forward in history.
 * @property {Function} autoArrange Runs the automatic layout.
 * @property {Function} exportData  Exports the graph as JSON.
 */

/**
 * Wires the global keydown handler.
 *
 * @param {AppActions} actions Application callbacks.
 * @returns {void}
 */
export function setupKeyboardShortcuts(actions) {
  document.addEventListener("keydown", (e) => {
    const key = (e.key || "").toLowerCase();
    const isEditable =
      e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";

    if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) {
      e.preventDefault();
      actions.undo();
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (key === "y" || (key === "z" && e.shiftKey))
    ) {
      e.preventDefault();
      actions.redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "a" && !isEditable) {
      e.preventDefault();
      actions.autoArrange();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "f") {
      e.preventDefault();
      showSearchModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "l") {
      e.preventDefault();
      openPagesModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "e") {
      e.preventDefault();
      actions.exportData();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "i") {
      e.preventDefault();
      dom.fileImport.click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && key === "d") {
      e.preventDefault();
      toggleFilter();
      actions.autoArrange();
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
}
