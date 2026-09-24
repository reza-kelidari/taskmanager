/**
 * @module details
 * @description Task details modal: opened with a left-click on a task node.
 * The right pane shows the title (with a done/cancelled status capsule),
 * the description below it, and the left pane shows the notes as a chat
 * thread (date below each bubble) with an auto-growing composer for new
 * notes at the bottom. Notes support hover edit/delete actions placed
 * outside the bubble, right-click menu editing/deletion, and inline
 * in-bubble editing.
 */
import { state } from "./state.js";
import { dom, hideAllMenus, positionFloating } from "./dom.js";
import { getShamsiDate, getCurrentTime, showToast } from "./utils.js";
import { saveNode } from "./db.js";
import { history } from "./history.js";
import { renderNodes } from "./renderer.js";
import { drawConnections } from "./connections.js";
import { errorReporter } from "./error.js";

const EDIT_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
const DELETE_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
const SAVE_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
const CANCEL_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
const COPY_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

/** Maximum auto-grown height (px) for textareas before they scroll. */
const TEXTAREA_MAX_HEIGHT = 180;

/** Index of the note being edited inline; -1 when idle. */
let editingIndex = -1;
/** Field being edited in the info pane: null | "title" | "desc". */
let infoEditing = null;
/** Index of the note targeted by the right-click comment menu. */
let menuIndex = -1;
/** Pending animated-close timer; cleared when the modal reopens. */
let closeTimer = null;
/** Exit animation length (ms); matches the staged CSS delays. */
const CLOSE_MS = 500;

/**
 * Returns the task currently shown in the details modal, if any.
 * @returns {object|null} Owner task node.
 */
function currentNode() {
  if (state.detailsNodeId == null) return null;
  return (
    state.nodes.find((n) => String(n.id) === String(state.detailsNodeId)) ??
    null
  );
}

/**
 * Auto-grows a textarea to fit its content up to a max height, after
 * which it scrolls. Manual resizing is disabled via CSS.
 *
 * @param {HTMLTextAreaElement} el Textarea to resize.
 * @returns {void}
 */
function autoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
}

/**
 * Copies text to the clipboard, with a textarea fallback for contexts
 * where the async Clipboard API is unavailable.
 *
 * @param {string} text Text to copy.
 * @returns {Promise<boolean>} True when the copy succeeded.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

/**
 * Copies a note's text to the clipboard.
 *
 * @param {number} index Note index within the node's `notes` array.
 * @returns {void}
 */
function copyComment(index) {
  const node = currentNode();
  const text = node?.notes?.[index]?.text ?? "";
  if (!node || !text) return;
  hideAllMenus();
  copyText(text).then((ok) => {
    showToast(ok ? "یادداشت کپی شد" : "خطا در کپی", ok ? "success" : "error");
  });
}

/**
 * Measures the rendered line count of a chat text element (or an edit
 * textarea, via its scroll height) and tags the chat item `single`
 * (horizontal actions) or `multi` (vertical actions).
 *
 * @param {HTMLElement} itemEl Chat item element.
 * @param {HTMLElement} el Text element or edit textarea inside the bubble.
 * @returns {void}
 */
function tagBubbleLines(itemEl, el) {
  try {
    let lines;
    if (el instanceof HTMLTextAreaElement) {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
      lines = Math.max(1, Math.round(el.scrollHeight / lh));
    } else {
      const range = document.createRange();
      range.selectNodeContents(el);
      lines = range.getClientRects().length;
    }
    itemEl.classList.toggle("multi", lines > 1);
    itemEl.classList.toggle("single", lines <= 1);
  } catch (_) {
    itemEl.classList.add("single");
  }
}

/**
 * Builds the hover action buttons (copy/edit/delete) for a note next to
 * the bubble.
 *
 * @param {number} index Note index within the node's `notes` array.
 * @returns {HTMLElement} Actions container.
 */
function buildActions(index) {
  const actions = document.createElement("span");
  actions.className = "chat-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "chat-action-btn";
  copyBtn.title = "کپی";
  copyBtn.setAttribute("aria-label", "کپی یادداشت");
  copyBtn.innerHTML = COPY_SVG;
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    copyComment(index);
  });

  const editBtn = document.createElement("button");
  editBtn.className = "chat-action-btn";
  editBtn.title = "ویرایش";
  editBtn.setAttribute("aria-label", "ویرایش یادداشت");
  editBtn.innerHTML = EDIT_SVG;
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startEditComment(index);
  });

  const delBtn = document.createElement("button");
  delBtn.className = "chat-action-btn delete-btn";
  delBtn.title = "حذف";
  delBtn.setAttribute("aria-label", "حذف یادداشت");
  delBtn.innerHTML = DELETE_SVG;
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteComment(index);
  });

  actions.appendChild(copyBtn);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  return actions;
}

/**
 * Renders the chat thread of a node: one bubble per note with its
 * date below it and hover copy/edit/delete actions outside the bubble.
 * Newest notes appear last.
 *
 * @param {object} node Owner task node.
 * @returns {void}
 */
function renderDetailsComments(node) {
  editingIndex = -1;
  dom.detailsComments.innerHTML = "";
  const notes = Array.isArray(node.notes) ? node.notes : [];
  if (notes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "details-empty";
    empty.textContent = "هنوز یادداشتی ثبت نشده است";
    dom.detailsComments.appendChild(empty);
    return;
  }
  notes.forEach((n, index) => {
    const item = document.createElement("div");
    item.className = "chat-item";
    item.dataset.index = String(index);

    const row = document.createElement("div");
    row.className = "chat-row";

    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";

    const text = document.createElement("span");
    text.className = "chat-text";
    text.textContent = n.text ?? "";
    bubble.appendChild(text);

    const date = document.createElement("div");
    date.className = "chat-date";
    date.textContent = `${n.date ?? ""} - ${n.time ?? ""}`.trim();

    row.appendChild(bubble);
    row.appendChild(buildActions(index));
    item.appendChild(row);
    item.appendChild(date);
    dom.detailsComments.appendChild(item);
    tagBubbleLines(item, text);
  });
  dom.detailsComments.scrollTop = dom.detailsComments.scrollHeight;
}

/**
 * Syncs the status capsule next to the title: green "انجام‌شده" for done
 * tasks, gray "لغوشده" for cancelled ones, yellow "تعلیق‌شده" for
 * suspended ones, hidden otherwise.
 *
 * @param {object} node Task node.
 * @returns {void}
 */
function renderStatusCapsule(node) {
  const el = dom.detailsStatus;
  if (!el) return;
  el.classList.remove("is-done", "is-cancelled", "is-suspended");
  if (node.done) {
    el.textContent = "انجام‌شده";
    el.classList.add("is-done");
    el.classList.remove("hidden");
  } else if (node.cancelled) {
    el.textContent = "لغوشده";
    el.classList.add("is-cancelled");
    el.classList.remove("hidden");
  } else if (node.suspended) {
    el.textContent = "تعلیق‌شده";
    el.classList.add("is-suspended");
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

/**
 * Discards an in-progress inline edit by re-rendering the thread.
 * @returns {void}
 */
function cancelInlineEdit() {
  const node = currentNode();
  editingIndex = -1;
  if (node) renderDetailsComments(node);
}

/**
 * Commits the inline edit: updates the note text (refreshing its
 * date/time) and re-renders the thread.
 * @returns {void}
 */
function saveInlineEdit() {
  const node = currentNode();
  const item = dom.detailsComments?.querySelector(
    `.chat-item[data-index="${editingIndex}"]`,
  );
  const input = item?.querySelector(".edit-input");
  const text = input?.value.trim() ?? "";
  if (!node || !input) return;
  if (!text) {
    showToast("متن یادداشت نمی‌تواند خالی باشد", "warning");
    return;
  }
  node.notes[editingIndex].text = text;
  node.notes[editingIndex].date = getShamsiDate();
  node.notes[editingIndex].time = getCurrentTime();
  saveNode(node);
  history.push(state.nodes, "ویرایش یادداشت");
  renderDetailsComments(node);
}

/**
 * Starts inline editing of a note inside its own bubble: swaps the text
 * for an auto-growing textarea and the hover actions for save/cancel.
 * Any other in-progress edit is discarded first.
 *
 * @param {number} index Note index within the node's `notes` array.
 * @returns {void}
 */
function startEditComment(index) {
  const node = currentNode();
  if (!node || !Array.isArray(node.notes) || !node.notes[index]) return;
  hideAllMenus();
  if (infoEditing) renderDetailsInfo(node);
  if (editingIndex !== -1 && editingIndex !== index) renderDetailsComments(node);
  editingIndex = index;

  const item = dom.detailsComments?.querySelector(
    `.chat-item[data-index="${index}"]`,
  );
  const bubble = item?.querySelector(".chat-bubble");
  const textEl = bubble?.querySelector(".chat-text");
  const actions = item?.querySelector(".chat-actions");
  if (!item || !bubble || !textEl || !actions) return;

  const input = document.createElement("textarea");
  input.className = "edit-input";
  input.value = node.notes[index].text ?? "";
  input.rows = 1;
  input.setAttribute("aria-label", "ویرایش یادداشت");
  bubble.replaceChild(input, textEl);
  tagBubbleLines(item, input);

  actions.innerHTML = "";
  const saveBtn = document.createElement("button");
  saveBtn.className = "save-icon-btn";
  saveBtn.title = "ذخیره";
  saveBtn.setAttribute("aria-label", "ذخیره ویرایش");
  saveBtn.innerHTML = SAVE_SVG;
  saveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    saveInlineEdit();
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "chat-action-btn";
  cancelBtn.title = "لغو";
  cancelBtn.setAttribute("aria-label", "لغو ویرایش");
  cancelBtn.innerHTML = CANCEL_SVG;
  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelInlineEdit();
  });
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);

  item.classList.add("editing");
  autoGrow(input);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  input.addEventListener("input", () => {
    autoGrow(input);
    tagBubbleLines(item, input);
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveInlineEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelInlineEdit();
    }
  });
  input.addEventListener("click", (e) => e.stopPropagation());
}

/**
 * Deletes a note after an inline confirmation shown in place of the
 * note itself (yes/no buttons inside the chat thread).
 *
 * @param {number} index Note index within the node's `notes` array.
 * @returns {void}
 */
function deleteComment(index) {
  const node = currentNode();
  if (!node || !Array.isArray(node.notes) || !node.notes[index]) return;
  hideAllMenus();
  if (editingIndex !== -1) renderDetailsComments(node);
  if (infoEditing) renderDetailsInfo(node);

  const item = dom.detailsComments?.querySelector(
    `.chat-item[data-index="${index}"]`,
  );
  const bubble = item?.querySelector(".chat-bubble");
  const actions = item?.querySelector(".chat-actions");
  const chatRow = item?.querySelector(".chat-row");
  const date = item?.querySelector(".chat-date");
  if (!item || !bubble || !actions || !chatRow || !date) return;

  bubble.style.display = "none";
  actions.style.display = "none";

  const confirm = document.createElement("div");
  confirm.className = "chat-confirm";

  const q = document.createElement("span");
  q.textContent = "آیا از حذف این یادداشت اطمینان دارید؟";

  const row = document.createElement("span");
  row.className = "chat-confirm-actions";

  const yes = document.createElement("button");
  yes.className = "chat-confirm-yes";
  yes.textContent = "بله";
  yes.addEventListener("click", (e) => {
    e.stopPropagation();
    node.notes.splice(index, 1);
    saveNode(node);
    history.push(state.nodes, "حذف یادداشت");
    const shown = currentNode();
    if (shown) renderDetailsComments(shown);
  });

  const no = document.createElement("button");
  no.className = "chat-confirm-no";
  no.textContent = "خیر";
  no.addEventListener("click", (e) => {
    e.stopPropagation();
    const shown = currentNode();
    if (shown) renderDetailsComments(shown);
  });

  row.appendChild(yes);
  row.appendChild(no);
  confirm.appendChild(q);
  confirm.appendChild(row);
  chatRow.appendChild(confirm);
}

/**
 * Renders the info pane (title, status capsule, description) and clears
 * any title/description edit state.
 *
 * @param {object} node Task node.
 * @returns {void}
 */
function renderDetailsInfo(node) {
  infoEditing = null;
  dom.detailsTitle.classList.remove("editing");
  dom.detailsDesc.classList.remove("editing");
  dom.detailsTitle.textContent = node.title ?? "";
  renderStatusCapsule(node);
  const desc = (node.note ?? "").trim();
  dom.detailsDesc.textContent =
    desc.length === 0 ? "توضیحی ثبت نشده است" : desc;
  dom.detailsDesc.classList.toggle("empty", desc.length === 0);
}

/**
 * Builds an accent save button with check icon + "ذخیره" text.
 *
 * @param {Function} onSave Save handler.
 * @returns {HTMLElement} Save button.
 */
function buildCheckButton(onSave) {
  const save = document.createElement("button");
  save.className = "save-text-btn";
  save.title = "ذخیره";
  save.setAttribute("aria-label", "ذخیره");
  save.innerHTML = `${SAVE_SVG}<span>ذخیره</span>`;
  const doSave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSave();
  };
  save.addEventListener("pointerdown", doSave);
  save.addEventListener("mousedown", doSave);
  save.addEventListener("click", (e) => {
    e.stopPropagation();
    onSave();
  });
  return save;
}

/**
 * Builds a gray cancel button with cross icon + "لغو" text.
 *
 * @param {Function} onCancel Cancel handler.
 * @returns {HTMLElement} Cancel button.
 */
function buildCrossButton(onCancel) {
  const cancel = document.createElement("button");
  cancel.className = "cancel-text-btn";
  cancel.title = "لغو";
  cancel.setAttribute("aria-label", "لغو ویرایش");
  cancel.innerHTML = `${CANCEL_SVG}<span>لغو</span>`;
  cancel.addEventListener("click", (e) => {
    e.stopPropagation();
    onCancel();
  });
  return cancel;
}

/**
 * Restores the info pane, discarding a title/description edit.
 * @returns {void}
 */
function cancelInfoEdit() {
  const node = currentNode();
  if (node) renderDetailsInfo(node);
}

/**
 * Starts inline editing of the task title (click on the title): input
 * with a check+text save button beside it. Clicking anywhere else
 * cancels; only the save button saves.
 * @returns {void}
 */
function startTitleEdit() {
  const node = currentNode();
  if (!node || infoEditing) return;
  if (editingIndex !== -1) renderDetailsComments(node);
  infoEditing = "title";

  const h3 = dom.detailsTitle;
  h3.classList.add("editing");
  h3.innerHTML = "";
  const row = document.createElement("div");
  row.className = "details-title-edit-row";
  const input = document.createElement("input");
  input.className = "details-edit-input";
  input.value = node.title ?? "";
  input.maxLength = 25;
  input.setAttribute("aria-label", "ویرایش عنوان");
  row.appendChild(input);
  row.appendChild(buildCheckButton(saveTitleEdit));
  h3.appendChild(row);
  input.focus();
  input.select();
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      saveTitleEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelInfoEdit();
    }
  });
  input.addEventListener("blur", () => cancelInfoEdit());
}

/**
 * Commits the title edit and refreshes the canvas node.
 * @returns {void}
 */
function saveTitleEdit() {
  const node = currentNode();
  const input = dom.detailsTitle.querySelector(".details-edit-input");
  const title = input?.value.trim() ?? "";
  if (!node || !input) return;
  if (!title) {
    showToast("عنوان نمی‌تواند خالی باشد", "warning");
    return;
  }
  node.title = title;
  saveNode(node);
  history.push(state.nodes, `ویرایش عنوان «${title}»`);
  renderDetailsInfo(node);
  renderNodes();
  drawConnections();
}

/**
 * Starts inline editing of the task description (click on it).
 * @returns {void}
 */
function startDescEdit() {
  const node = currentNode();
  if (!node || infoEditing) return;
  if (editingIndex !== -1) renderDetailsComments(node);
  infoEditing = "desc";

  const p = dom.detailsDesc;
  p.classList.add("editing");
  p.innerHTML = "";
  p.classList.remove("empty");
  const area = document.createElement("textarea");
  area.className = "details-edit-area";
  area.value = node.note ?? "";
  area.rows = 2;
  area.setAttribute("aria-label", "ویرایش توضیحات");
  p.appendChild(area);
  const actions = document.createElement("div");
  actions.className = "details-edit-actions";
  actions.appendChild(buildCheckButton(saveDescEdit));
  actions.appendChild(buildCrossButton(cancelInfoEdit));
  p.appendChild(actions);
  autoGrow(area);
  area.focus();
  area.addEventListener("click", (e) => e.stopPropagation());
  area.addEventListener("input", () => autoGrow(area));
  area.addEventListener("blur", () => cancelInfoEdit());
  area.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      cancelInfoEdit();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveDescEdit();
    }
  });
}

/**
 * Commits the description edit.
 * @returns {void}
 */
function saveDescEdit() {
  const node = currentNode();
  const area = dom.detailsDesc.querySelector(".details-edit-area");
  if (!node || !area) return;
  node.note = area.value.trim();
  saveNode(node);
  history.push(state.nodes, "ویرایش توضیحات");
  renderDetailsInfo(node);
}

/**
 * Opens the details modal for a task node with a staged entrance
 * animation (window, then title/status, description, comments).
 *
 * @param {object} node Task node to display.
 * @returns {void}
 */
export function showDetailsModal(node) {
  if (!node || !dom.detailsModal) return;
  try {
    state.detailsNodeId = node.id;
    if (!Array.isArray(node.notes)) node.notes = [];
    editingIndex = -1;
    hideAllMenus();
    renderDetailsInfo(node);
    dom.hoverBox?.classList.add("hidden");
    clearTimeout(closeTimer);
    dom.detailsModal.classList.remove("hidden");
    void dom.detailsModal.offsetWidth;
    dom.detailsModal.classList.add("open");
    renderDetailsComments(node);
    if (dom.detailsCommentInput) {
      dom.detailsCommentInput.value = "";
      autoGrow(dom.detailsCommentInput);
    }
  } catch (error) {
    errorReporter.report(error, { context: "showDetailsModal" });
  }
}

/**
 * Closes the details modal with its exit animation (~0.5s), then
 * unmounts it. Reopening within the window cancels the pending hide.
 * Registered as `window.__closeDetailsModal` for hideAllModals.
 * @returns {void}
 */
export function closeDetailsModal() {
  if (!dom.detailsModal || dom.detailsModal.classList.contains("hidden"))
    return;
  hideAllMenus();
  editingIndex = -1;
  state.detailsNodeId = null;
  dom.detailsModal.classList.remove("open");
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    if (!dom.detailsModal.classList.contains("open")) {
      dom.detailsModal.classList.add("hidden");
    }
  }, CLOSE_MS);
}

/**
 * Appends the composer text as a new note on the open task.
 * @returns {void}
 */
function sendDetailsComment() {
  try {
    const text = dom.detailsCommentInput?.value.trim() ?? "";
    if (!text) {
      showToast("متن یادداشت نمی‌تواند خالی باشد", "warning");
      return;
    }
    const node = currentNode();
    if (!node) {
      showToast("وظیفه یافت نشد", "error");
      return;
    }
    if (!Array.isArray(node.notes)) node.notes = [];
    node.notes.push({ text, date: getShamsiDate(), time: getCurrentTime() });
    saveNode(node);
    history.push(state.nodes, "افزودن یادداشت");
    dom.detailsCommentInput.value = "";
    autoGrow(dom.detailsCommentInput);
    renderDetailsComments(node);
  } catch (error) {
    errorReporter.report(error, { context: "sendDetailsComment" });
    showToast("خطا در ثبت یادداشت", "error");
  }
}

/**
 * Shows the right-click menu for a note at the pointer position.
 *
 * @param {number} index Note index within the node's `notes` array.
 * @param {number} x Viewport X coordinate.
 * @param {number} y Viewport Y coordinate.
 * @returns {void}
 */
function showCommentMenu(index, x, y) {
  const node = currentNode();
  if (!node || !dom.detailsCommentMenu) return;
  menuIndex = index;
  hideAllMenus();
  positionFloating(dom.detailsCommentMenu, x, y);
}

/**
 * Wires the details modal: close button (animated), click-to-edit
 * title/description, send button, auto-growing composer (Enter sends,
 * Shift+Enter inserts a newline), note right-click menu and its items.
 * Registers `window.__closeDetailsModal` for hideAllModals. Call once
 * during bootstrapping.
 * @returns {void}
 */
export function setupDetailsModal() {
  window.__closeDetailsModal = closeDetailsModal;
  document.getElementById("details-close")?.addEventListener("click", () => {
    closeDetailsModal();
  });

  document.querySelector(".details-info")?.addEventListener("click", (e) => {
    if (infoEditing) return;
    if (dom.detailsModal?.classList.contains("hidden")) return;
    if (e.target.closest("#details-title")) startTitleEdit();
    else if (e.target.closest("#details-desc")) startDescEdit();
  });
  document
    .getElementById("details-comment-send")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      sendDetailsComment();
    });
  dom.detailsCommentInput?.addEventListener("input", () =>
    autoGrow(dom.detailsCommentInput),
  );
  dom.detailsCommentInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendDetailsComment();
    }
  });

  dom.detailsComments?.addEventListener("contextmenu", (e) => {
    const item = e.target.closest?.(".chat-item");
    if (!item || dom.detailsModal?.classList.contains("hidden")) return;
    e.preventDefault();
    e.stopPropagation();
    showCommentMenu(parseInt(item.dataset.index), e.clientX, e.clientY);
  });

  dom.detailsCommentMenu
    ?.querySelector('[data-action="copy-comment"]')
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      dom.detailsCommentMenu.classList.add("hidden");
      if (menuIndex >= 0) copyComment(menuIndex);
    });
  dom.detailsCommentMenu
    ?.querySelector('[data-action="edit-comment"]')
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      dom.detailsCommentMenu.classList.add("hidden");
      if (menuIndex >= 0) startEditComment(menuIndex);
    });
  dom.detailsCommentMenu
    ?.querySelector('[data-action="delete-comment"]')
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      dom.detailsCommentMenu.classList.add("hidden");
      if (menuIndex >= 0) deleteComment(menuIndex);
    });
}
