import { state } from "./state.js";
import { dom, positionFloating } from "./dom.js";
import {
  getShamsiDate,
  getCurrentTime,
  showToast,
  saveDraft,
  loadDraft,
  clearDraft,
} from "./utils.js";
import { saveNode } from "./db.js";
import { history } from "./history.js";
import { renderNodes } from "./renderer.js";

export function showNotesMenu(x, y, node) {
  positionFloating(dom.notesMenu, x, y);
  renderNotesList(node);
}

export function renderNotesList(node) {
  dom.notesList.innerHTML = "";
  if (!node.notes || node.notes.length === 0) return;
  node.notes.forEach((n, index) => {
    const item = document.createElement("div");
    item.className = "note-list-item";
    const textContainer = document.createElement("div");
    textContainer.className = "note-text-container";
    const displayText =
      n.text.length > 15 ? n.text.substring(0, 15) + "..." : n.text;
    const metaDiv = document.createElement("div");
    metaDiv.className = "note-meta";
    metaDiv.textContent = `${n.date} - ${n.time}`;
    const previewDiv = document.createElement("div");
    previewDiv.className = "note-text-preview";
    previewDiv.textContent = displayText;
    textContainer.appendChild(metaDiv);
    textContainer.appendChild(previewDiv);
    const actions = document.createElement("div");
    actions.className = "note-actions";
    const editBtn = document.createElement("button");
    editBtn.className = "note-action-btn";
    editBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openNoteModal(true, index, n.text);
    });
    const delBtn = document.createElement("button");
    delBtn.className = "note-action-btn delete-btn";
    delBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const x = parseInt(dom.notesMenu.style.left);
      const y = parseInt(dom.notesMenu.style.top);
      dom.notesMenu.classList.add("hidden");
      state.pendingDeleteAction = () => {
        node.notes.splice(index, 1);
        saveNode(node);
        history.push(state.nodes, "حذف یادداشت");
        dom.confirmModal.classList.add("hidden");
        showNotesMenu(x, y, node);
        renderNodes();
      };
      positionFloating(dom.confirmModal, x, y);
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    item.appendChild(textContainer);
    item.appendChild(actions);
    dom.notesList.appendChild(item);
  });
}

export function openNoteModal(isEditing, index, text) {
  state.editingNoteIndex = index;
  const draftKey =
    state.currentNoteNodeId != null
      ? `note_${state.currentNoteNodeId}_${index}`
      : "note_temp";
  const draft = loadDraft(draftKey);
  dom.noteTextInput.value = draft?.text ?? text;
  const x = parseInt(dom.notesMenu.style.left);
  const y = parseInt(dom.notesMenu.style.top);
  dom.notesMenu.classList.add("hidden");
  positionFloating(dom.noteModal, x, y);
  dom.noteTextInput.focus();

  dom.noteTextInput.oninput = () => {
    saveDraft(draftKey, { text: dom.noteTextInput.value });
  };
  dom.noteModal.dataset.draftKey = draftKey;
}

export function saveNote() {
  const text = dom.noteTextInput.value.trim();
  if (!text || !state.currentNoteNodeId) {
    showToast("متن یادداشت نمی‌تواند خالی باشد", "warning");
    return;
  }
  const node = state.nodes.find((n) => n.id == state.currentNoteNodeId);
  if (!node.notes) node.notes = [];
  if (state.editingNoteIndex >= 0) {
    // Update text and refresh date/time on edit
    node.notes[state.editingNoteIndex].text = text;
    node.notes[state.editingNoteIndex].date = getShamsiDate();
    node.notes[state.editingNoteIndex].time = getCurrentTime();
  } else {
    node.notes.push({ text, date: getShamsiDate(), time: getCurrentTime() });
  }
  saveNode(node);
  history.push(state.nodes, "ویرایش/افزودن یادداشت");
  const draftKey = dom.noteModal.dataset.draftKey;
  if (draftKey) clearDraft(draftKey);
  dom.noteTextInput.value = "";
  dom.noteTextInput.oninput = null;
  dom.noteModal.classList.add("hidden");
  const x = parseInt(dom.noteModal.style.left);
  const y = parseInt(dom.noteModal.style.top);
  showNotesMenu(x, y, node);
  renderNodes();
}
