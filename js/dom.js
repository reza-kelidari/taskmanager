/**
 * @module dom
 * @description Cached DOM references plus positioning utilities for
 * floating UI elements (menus, modals, tooltips).
 */

/**
 * Cached references to every DOM element the application interacts with.
 * @type {object}
 */
export const dom = {
  canvas: document.getElementById("canvas"),
  svgLayer: document.getElementById("connections-layer"),
  dateDisplay: document.getElementById("date-display"),
  emptyState: document.getElementById("empty-state"),
  hoverBox: document.getElementById("hover-box"),
  contextMenu: document.getElementById("context-menu"),
  elementMenu: document.getElementById("element-menu"),
  notesMenu: document.getElementById("notes-menu"),
  inputModal: document.getElementById("input-modal"),
  noteModal: document.getElementById("note-modal"),
  confirmModal: document.getElementById("confirm-modal"),
  searchModal: document.getElementById("search-modal"),
  inputTitle: document.getElementById("input-title"),
  inputNote: document.getElementById("input-note"),
  noteTextInput: document.getElementById("note-text-input"),
  notesList: document.getElementById("notes-list"),
  searchInput: document.getElementById("search-input"),
  searchResults: document.getElementById("search-results"),
  fileImport: document.getElementById("file-import"),
  toastContainer: document.getElementById("toast-container"),
  moreMenu: document.getElementById("more-menu"),
  historyPanel: document.getElementById("history-panel"),
  pageMenu: document.getElementById("page-menu"),
  moveMenu: document.getElementById("move-menu"),
  movePageList: document.getElementById("move-page-list"),
  diffModal: document.getElementById("diff-modal"),
  filterActiveBtn: document.getElementById("tool-filter-active"),
  detailsModal: document.getElementById("details-modal"),
  detailsTitle: document.getElementById("details-title"),
  detailsStatus: document.getElementById("details-status"),
  detailsDesc: document.getElementById("details-desc"),
  detailsComments: document.getElementById("details-comments"),
  detailsCommentInput: document.getElementById("details-comment-input"),
  detailsCommentMenu: document.getElementById("details-comment-menu"),
};

/**
 * Hides every context-style menu (canvas, element, notes, more, page,
 * move, history panel, details-comment menu).
 * @returns {void}
 */
export function hideAllMenus() {
  dom.contextMenu.classList.add("hidden");
  dom.elementMenu.classList.add("hidden");
  dom.notesMenu.classList.add("hidden");
  dom.moreMenu.classList.add("hidden");
  if (dom.pageMenu) dom.pageMenu.classList.add("hidden");
  if (dom.moveMenu) dom.moveMenu.classList.add("hidden");
  if (dom.detailsCommentMenu) dom.detailsCommentMenu.classList.add("hidden");
  if (dom.historyPanel) dom.historyPanel.classList.add("hidden");
}

/**
 * Hides every modal dialog (input, note, confirm, search, diff, details).
 * The details modal closes with its exit animation when available.
 * @returns {void}
 */
export function hideAllModals() {
  dom.inputModal.classList.add("hidden");
  dom.noteModal.classList.add("hidden");
  dom.confirmModal.classList.add("hidden");
  dom.searchModal.classList.add("hidden");
  if (dom.diffModal) dom.diffModal.classList.add("hidden");
  if (dom.detailsModal) {
    if (typeof window !== "undefined" && window.__closeDetailsModal) {
      window.__closeDetailsModal();
    } else {
      dom.detailsModal.classList.add("hidden");
    }
  }
}

/**
 * Places a floating element at (`x`, `y`), flipping it above/left of the
 * anchor point when it would overflow the viewport, and clamping it to a
 * 10px margin from every edge. Also removes the `hidden` class.
 *
 * @param {HTMLElement} el Element to position and reveal.
 * @param {number} x Viewport X coordinate (right-edge anchor under RTL).
 * @param {number} y Viewport Y coordinate (top anchor).
 * @returns {void}
 */
export function positionFloating(el, x, y) {
  el.style.top = `${y}px`;
  el.style.left = `${x}px`;
  el.classList.remove("hidden");
  const rect = el.getBoundingClientRect();
  let newTop = y,
    newLeft = x;
  if (rect.bottom > window.innerHeight - 10) newTop = y - rect.height;
  if (rect.right > window.innerWidth - 10) newLeft = x - rect.width;
  if (newTop < 10) newTop = 10;
  if (newLeft < 10) newLeft = 10;
  el.style.top = `${newTop}px`;
  el.style.left = `${newLeft}px`;
}

/**
 * Positions the node hover box near the pointer, flipping it above the
 * cursor when it would overflow the bottom or right viewport edge.
 *
 * @param {number} clientX Pointer viewport X.
 * @param {number} clientY Pointer viewport Y.
 * @returns {void}
 */
export function positionHoverBox(clientX, clientY) {
  dom.hoverBox.style.top = `${clientY + 15}px`;
  dom.hoverBox.style.left = `${clientX}px`;
  const rect = dom.hoverBox.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 10)
    dom.hoverBox.style.top = `${clientY - rect.height - 15}px`;
  if (rect.right > window.innerWidth - 10)
    dom.hoverBox.style.left = `${clientX - rect.width}px`;
}
