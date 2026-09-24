/**
 * @module modals
 * @description The node input modal (create/edit header or task) with
 * localStorage-backed drafts, so partially typed content survives an
 * accidental close or a page refresh.
 */
import { state } from "./state.js";
import { dom, positionFloating } from "./dom.js";
import { showToast, saveDraft, loadDraft, clearDraft } from "./utils.js";
import { CONFIG } from "./config.js";
import { saveNode } from "./db.js";
import { history } from "./history.js";

/**
 * Opens the input modal for creating or editing a node. When a draft was
 * previously saved for this exact context it pre-fills the fields, and
 * every keystroke live-saves a new draft.
 *
 * @param {("header"|"task")} type Node type being created/edited.
 * @param {number} x Viewport X anchor (menu position).
 * @param {number} y Viewport Y anchor.
 * @param {object|null} [node=null] Node being edited; null for creation.
 * @returns {void}
 */
export function showInputModal(type, x, y, node = null) {
  state.editingNodeId = node ? node.id : null;
  const draftKey = node ? `input_${node.id}` : `input_new_${type}`;
  const draft = loadDraft(draftKey);

  if (draft) {
    dom.inputTitle.value = draft.title ?? (node ? node.title : "");
    dom.inputNote.value = draft.note ?? (node ? node.note || "" : "");
  } else {
    dom.inputTitle.value = node ? node.title : "";
    dom.inputNote.value = node ? node.note || "" : "";
  }

  dom.inputNote.style.display = type === "task" ? "block" : "none";
  dom.inputModal.dataset.type = type;
  dom.inputModal.dataset.x = x;
  dom.inputModal.dataset.y = y;
  dom.inputModal.dataset.draftKey = draftKey;
  positionFloating(dom.inputModal, x, y);
  dom.inputTitle.focus();

  const persist = () => {
    saveDraft(draftKey, {
      title: dom.inputTitle.value,
      note: dom.inputNote.value,
      type,
      editingId: state.editingNodeId,
    });
  };
  dom.inputTitle.oninput = persist;
  dom.inputNote.oninput = persist;
}

/**
 * Persists the modal content: updates the edited node in place or creates
 * a new one near the anchor point, records a labeled history entry and
 * clears the consumed drafts. Rejects an empty title with a warning toast.
 *
 * @returns {{result: object, wasEditingId: string|null}|null} The saved
 *   node and the pre-save editing id, or null when validation failed.
 */
export function saveInput() {
  const title = dom.inputTitle.value.trim();
  const note = dom.inputNote.value.trim();
  const type = dom.inputModal.dataset.type;
  const x = parseInt(dom.inputModal.dataset.x);
  const y = parseInt(dom.inputModal.dataset.y);
  const draftKey = dom.inputModal.dataset.draftKey;
  if (!title) {
    showToast("عنوان نمی‌تواند خالی باشد", "warning");
    return null;
  }
  const wasEditingId = state.editingNodeId;
  let result;
  if (state.editingNodeId) {
    let node = state.nodes.find((n) => n.id == state.editingNodeId);
    const oldTitle = node.title;
    node.title = title;
    if (node.type === "task") node.note = note;
    saveNode(node);
    result = node;
    history.push(
      state.nodes,
      wasEditingId ? `ویرایش «${oldTitle}»` : `ویرایش «${title}»`,
    );
  } else {
    const rect = dom.canvas.getBoundingClientRect();
    const generateId = () => {
      if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
      )
        return crypto.randomUUID();
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c == "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };
    const newNode = {
      id: generateId(),
      type,
      title,
      note,
      done: false,
      parent: null,
      notes: [],
      pageId: state.activePageId,
      x: x - rect.left,
      y: y - rect.top + CONFIG.CANVAS_INITIAL_Y_OFFSET,
    };
    state.nodes.push(newNode);
    saveNode(newNode);
    result = newNode;
    if (dom.emptyState) dom.emptyState.style.display = "none";
    history.push(
      state.nodes,
      type === "header" ? `سرفصل جدید «${title}»` : `وظیفه جدید «${title}»`,
    );
  }
  if (draftKey) clearDraft(draftKey);
  clearDraft(`input_new_${type}`);
  dom.inputModal.classList.add("hidden");
  state.editingNodeId = null;
  dom.inputTitle.oninput = null;
  dom.inputNote.oninput = null;
  return { result, wasEditingId };
}
