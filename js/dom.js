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
  diffModal: document.getElementById("diff-modal"),
  filterActiveBtn: document.getElementById("tool-filter-active"),
};

export function hideAllMenus() {
  dom.contextMenu.classList.add("hidden");
  dom.elementMenu.classList.add("hidden");
  dom.notesMenu.classList.add("hidden");
  dom.moreMenu.classList.add("hidden");
  if (dom.historyPanel) dom.historyPanel.classList.add("hidden");
}

export function hideAllModals() {
  dom.inputModal.classList.add("hidden");
  dom.noteModal.classList.add("hidden");
  dom.confirmModal.classList.add("hidden");
  dom.searchModal.classList.add("hidden");
  if (dom.diffModal) dom.diffModal.classList.add("hidden");
}

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

export function positionHoverBox(clientX, clientY) {
  dom.hoverBox.style.top = `${clientY + 15}px`;
  dom.hoverBox.style.left = `${clientX}px`;
  const rect = dom.hoverBox.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 10)
    dom.hoverBox.style.top = `${clientY - rect.height - 15}px`;
  if (rect.right > window.innerWidth - 10)
    dom.hoverBox.style.left = `${clientX - rect.width}px`;
}
