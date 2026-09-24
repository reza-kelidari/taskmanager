/**
 * @module utils
 * @description Shared, dependency-light helpers: toasts, Shamsi dates,
 * graph predicates (multi-input aware), done-filter visibility (completed
 * tasks plus fully-done non-root headers), and localStorage-backed drafts
 * for text fields.
 */
import { CONFIG } from "./config.js";
import { state } from "./state.js";
import { dom } from "./dom.js";

/**
 * Returns true for any finite number.
 * @param {*} v Value to test.
 * @returns {boolean}
 */
export const finite = (v) => Number.isFinite(v);

/**
 * Escapes a value for safe interpolation into HTML markup.
 *
 * @param {*} text Raw value (null/undefined become empty string).
 * @returns {string} HTML-escaped representation.
 */
export function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * Shows a dismissible toast notification that auto-expires after
 * {@link CONFIG.TOAST_DURATION} unless paused by hovering the stack.
 *
 * @param {string} message Text to display.
 * @param {("info"|"success"|"warning"|"error")} [type="info"] Visual style.
 * @returns {void}
 */
export function showToast(message, type = "info") {
  const toastEl = document.createElement("div");
  toastEl.className = `toast toast-${type}`;
  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.setAttribute("aria-label", "بستن");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeToast(toastEl);
  });
  const textEl = document.createElement("span");
  textEl.className = "toast-text";
  textEl.textContent = message;
  toastEl.appendChild(closeBtn);
  toastEl.appendChild(textEl);
  dom.toastContainer.appendChild(toastEl);
  const timerObj = {
    element: toastEl,
    remaining: CONFIG.TOAST_DURATION,
    startTime: Date.now(),
    timerId: null,
  };
  timerObj.timerId = setTimeout(
    () => removeToast(toastEl),
    CONFIG.TOAST_DURATION,
  );
  toastEl._timerObj = timerObj;
  state.toastTimers.push(timerObj);
}

/**
 * Gracefully removes a toast: cancels its timer, detaches it from the
 * bookkeeping list and plays the exit transition before DOM removal.
 *
 * @param {HTMLElement} toastEl Toast element (may already be detached).
 * @returns {void}
 */
export function removeToast(toastEl) {
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

/**
 * Pauses every active toast, freezing the remaining lifetime of each.
 * @returns {void}
 */
export function pauseAllToasts() {
  state.isToastPaused = true;
  state.toastTimers.forEach((t) => {
    clearTimeout(t.timerId);
    t.remaining -= Date.now() - t.startTime;
    if (t.remaining < 0) t.remaining = 0;
  });
}

/**
 * Resumes every paused toast with a freshly scheduled timeout.
 * @returns {void}
 */
export function resumeAllToasts() {
  state.isToastPaused = false;
  state.toastTimers.forEach((t) => {
    t.startTime = Date.now();
    t.timerId = setTimeout(() => removeToast(t.element), t.remaining);
  });
}

/**
 * Creates a debounced wrapper around `fn`.
 *
 * @param {Function} func Function to debounce.
 * @param {number} [wait=CONFIG.DEBOUNCE_DELAY] Delay in milliseconds.
 * @returns {Function} Debounced function.
 */
export function debounce(func, wait = CONFIG.DEBOUNCE_DELAY) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Returns today's date in the Persian (Shamsi) calendar.
 * @returns {string} e.g. "دوشنبه، خرداد ۱۰".
 */
export function getShamsiDate() {
  return new Date().toLocaleDateString("fa-IR", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Returns the current time of day in 24-hour Persian format.
 * @returns {string} e.g. "۱۴:۰۵".
 */
export function getCurrentTime() {
  return new Date().toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Legacy single-parent ancestor check (primary-parent chain only).
 * Prefer {@link isAncestorMulti} for graph-aware checks.
 *
 * @param {string} potentialAncestorId Candidate ancestor id.
 * @param {string} nodeId Start node id.
 * @returns {boolean} True if the candidate is an ancestor of the start node.
 */
export function isAncestor(potentialAncestorId, nodeId) {
  let current = state.nodes.find((n) => n.id == nodeId);
  while (current && current.parent) {
    if (current.parent === potentialAncestorId) return true;
    current = state.nodes.find((n) => n.id == current.parent);
  }
  return false;
}

/* ============================================================
 * Multi-input graph predicates
 * ============================================================ */

/**
 * Returns all input (parent) ids of a node: the primary parent first,
 * followed by every extra parent. The first input a node ever receives
 * becomes its primary parent (layout-defining); later inputs are stored
 * in `extraParents` and are visual threads only.
 *
 * @param {object} node Node to inspect.
 * @returns {Array<string>} Input ids (primary first). Empty for roots.
 */
export function nodeParentIds(node) {
  if (!node) return [];
  const ids = [];
  if (node.parent !== null && node.parent !== undefined) ids.push(node.parent);
  if (Array.isArray(node.extraParents)) ids.push(...node.extraParents);
  return ids;
}

/**
 * Duplicate-connection check: whether `node` already has an input coming
 * from `sourceId`.
 *
 * @param {object} node Receiving node.
 * @param {string} sourceId Candidate source id.
 * @returns {boolean}
 */
export function hasInputFrom(node, sourceId) {
  return nodeParentIds(node).some((id) => String(id) === String(sourceId));
}

/**
 * Cycle-safe ancestor check across the full multi-input graph: performs a
 * BFS upward through every input (primary and extra) of each visited node.
 *
 * @param {string} potentialAncestorId Candidate ancestor id.
 * @param {string} startNodeId Start node id.
 * @returns {boolean} True if the candidate is reachable upward from start.
 */
export function isAncestorMulti(potentialAncestorId, startNodeId) {
  const queue = [startNodeId];
  const visited = new Set();
  while (queue.length) {
    const key = String(queue.shift());
    if (visited.has(key)) continue;
    visited.add(key);
    const n = state.nodes.find((x) => String(x.id) === key);
    if (!n) continue;
    for (const p of nodeParentIds(n)) {
      if (String(p) === String(potentialAncestorId)) return true;
      queue.push(p);
    }
  }
  return false;
}

/**
 * Validates a connection ignoring whether it already exists. Used when a
 * thread is being replaced in place.
 *
 * Rules:
 * - No self-connection.
 * - No cycle: the target (input receiver) must not be an ancestor of the
 *   source. Connecting a source to its own descendant IS allowed — that is
 *   the shortcut thread (A > C alongside A > B > C); since the target is
 *   already a descendant of the source, no cycle can be created.
 * - Type compatibility: a header may feed anything; a task may only feed
 *   another task.
 *
 * @param {object} sourceNode Feeding node.
 * @param {object} targetNode Receiving node.
 * @returns {boolean}
 */
export function canConnectRaw(sourceNode, targetNode) {
  if (!sourceNode || !targetNode) return false;
  if (String(sourceNode.id) === String(targetNode.id)) return false;
  if (isAncestorMulti(targetNode.id, sourceNode.id)) return false;
  if ((sourceNode.pageId ?? null) !== (targetNode.pageId ?? null))
    return false;
  if (sourceNode.type === "header") return true;
  if (sourceNode.type === "task") return targetNode.type === "task";
  return false;
}

/**
 * Full connection validation: {@link canConnectRaw} plus the
 * duplicate-input check ({@link hasInputFrom}).
 *
 * @param {object} sourceNode Feeding node.
 * @param {object} targetNode Receiving node.
 * @returns {boolean}
 */
export function canConnect(sourceNode, targetNode) {
  return (
    canConnectRaw(sourceNode, targetNode) &&
    !hasInputFrom(targetNode, sourceNode ? sourceNode.id : null)
  );
}

/**
 * Whether a node belongs to the currently active page. Before pages
 * boot (`activePageId` null) every node counts as active.
 *
 * @param {object} node Node to test.
 * @returns {boolean}
 */
export function isActivePageNode(node) {
  if (!node) return false;
  if (state.activePageId == null) return true;
  return String(node.pageId ?? "") === String(state.activePageId);
}

/**
 * Depth of a header in the header hierarchy (primary-parent chain).
 * Root headings have depth 0, their direct sub-headings depth 1, etc.
 *
 * @param {object} node Header node.
 * @returns {number} Number of header ancestors.
 */
export function headingDepth(node) {
  let depth = 0;
  let parentId = node.parent;
  const guard = new Set();
  while (parentId !== null && parentId !== undefined) {
    const key = String(parentId);
    if (guard.has(key)) break;
    guard.add(key);
    const parent = state.nodes.find((n) => String(n.id) === key);
    if (!parent) break;
    if (parent.type === "header") depth += 1;
    parentId = parent.parent;
  }
  return depth;
}

/**
 * Collects every descendant task of a header (primary children and
 * extra-parent threads, traversed recursively through headers and tasks).
 * Cycle-guarded for the multi-input DAG.
 *
 * @param {string} headerId Header id.
 * @returns {Array<object>} Descendant task nodes.
 */
export function collectDescendantTasks(headerId) {
  const tasks = [];
  const visited = new Set([String(headerId)]);
  const queue = [String(headerId)];
  while (queue.length) {
    const curId = queue.shift();
    for (const n of state.nodes) {
      const isChild =
        String(n.parent ?? "") === curId ||
        (Array.isArray(n.extraParents) &&
          n.extraParents.some((id) => String(id) === curId));
      if (!isChild) continue;
      const key = String(n.id);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(key);
      if (n.type === "task") tasks.push(n);
    }
  }
  return tasks;
}

/**
 * Whether a non-root header qualifies for auto-hiding under the done-task
 * filter: depth >= 1 (second heading or deeper) with at least one
 * descendant task and every descendant task marked done.
 *
 * @param {object} node Header node.
 * @returns {boolean}
 */
export function isHeaderAutoHidden(node) {
  if (!node || node.type !== "header") return false;
  if (headingDepth(node) < 1) return false;
  const tasks = collectDescendantTasks(node.id);
  if (tasks.length === 0) return false;
  return tasks.every((t) => !!t.done);
}

/**
 * Returns true while the done-task filter is active and the node should be
 * removed from the canvas:
 * - completed tasks are always hidden;
 * - non-root headers (second heading or deeper) are hidden only when all
 *   of their subtasks are marked completed.
 * Layout, hit-testing and rendering must all skip such nodes.
 *
 * @param {object} node Node to test.
 * @returns {boolean}
 */
export function isNodeHidden(node) {
  if (!node) return false;
  if (!document.body.classList.contains("filter-active")) return false;
  if (node.type === "task") return !!node.done;
  if (node.type === "header") return isHeaderAutoHidden(node);
  return false;
}

/**
 * Whether any menu/modal is open that should suppress the node hover box.
 * @returns {boolean}
 */
export function shouldShowHoverBox() {
  return (
    !dom.elementMenu.classList.contains("hidden") ||
    !dom.contextMenu.classList.contains("hidden") ||
    !dom.notesMenu.classList.contains("hidden") ||
    !dom.noteModal.classList.contains("hidden") ||
    !dom.confirmModal.classList.contains("hidden") ||
    (dom.detailsModal && !dom.detailsModal.classList.contains("hidden"))
  );
}

/* ============================================================
 * Draft persistence for text fields
 * (survives refresh / accidental modal close)
 * ============================================================ */

/**
 * Persists a draft payload under `draft_<key>` in localStorage.
 * Best-effort: storage failures are swallowed.
 *
 * @param {string} key Draft key.
 * @param {object} data JSON-serializable payload.
 * @returns {void}
 */
export function saveDraft(key, data) {
  try {
    localStorage.setItem(`draft_${key}`, JSON.stringify(data));
  } catch (_) {
    /* storage unavailable */
  }
}

/**
 * Loads a previously saved draft.
 *
 * @param {string} key Draft key.
 * @returns {object|null} Parsed payload, or null when absent/corrupt.
 */
export function loadDraft(key) {
  try {
    const raw = localStorage.getItem(`draft_${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Removes a draft (typically after it has been consumed by a save).
 *
 * @param {string} key Draft key.
 * @returns {void}
 */
export function clearDraft(key) {
  try {
    localStorage.removeItem(`draft_${key}`);
  } catch (_) {
    /* storage unavailable */
  }
}
