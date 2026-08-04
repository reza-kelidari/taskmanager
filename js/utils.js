import { CONFIG } from "./config.js";
import { state } from "./state.js";
import { dom } from "./dom.js";

export function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

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

export function pauseAllToasts() {
  state.isToastPaused = true;
  state.toastTimers.forEach((t) => {
    clearTimeout(t.timerId);
    t.remaining -= Date.now() - t.startTime;
    if (t.remaining < 0) t.remaining = 0;
  });
}

export function resumeAllToasts() {
  state.isToastPaused = false;
  state.toastTimers.forEach((t) => {
    t.startTime = Date.now();
    t.timerId = setTimeout(() => removeToast(t.element), t.remaining);
  });
}

export function debounce(func, wait = CONFIG.DEBOUNCE_DELAY) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function getShamsiDate() {
  return new Date().toLocaleDateString("fa-IR", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function getCurrentTime() {
  return new Date().toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function isAncestor(potentialAncestorId, nodeId) {
  let current = state.nodes.find((n) => n.id == nodeId);
  while (current && current.parent) {
    if (current.parent === potentialAncestorId) return true;
    current = state.nodes.find((n) => n.id == current.parent);
  }
  return false;
}

export function canConnect(sourceNode, targetNode) {
  if (!sourceNode || !targetNode) return false;
  if (sourceNode.id === targetNode.id) return false;
  if (isAncestor(targetNode.id, sourceNode.id)) return false;
  if (isAncestor(sourceNode.id, targetNode.id)) return false;
  if (sourceNode.type === "header") return true;
  if (sourceNode.type === "task") return targetNode.type === "task";
  return false;
}

export function shouldShowHoverBox() {
  return (
    !dom.elementMenu.classList.contains("hidden") ||
    !dom.contextMenu.classList.contains("hidden") ||
    !dom.notesMenu.classList.contains("hidden") ||
    !dom.noteModal.classList.contains("hidden") ||
    !dom.confirmModal.classList.contains("hidden")
  );
}
