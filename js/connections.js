/**
 * @module connections
 * @description Renders the connection threads (SVG paths) between nodes:
 * one thread per input, invisible grabbable hit areas, projected
 * (ancestor-skipping) threads with an eye-off badge and tooltip, and the
 * yellow highlight for a thread targeted by an in-flight replacement.
 *
 * Thread grabbing is NOT wired here — drag.js attaches a single delegated
 * mousedown listener on the SVG layer, which keeps this module
 * render-only and free of circular imports.
 */
import { state } from "./state.js";
import { dom } from "./dom.js";
import { isNodeHidden, isActivePageNode, nodeParentIds } from "./utils.js";
import { getRenderedEl } from "./renderer.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PROJECTED_THREAD_TOOLTIP_TEXT = "برخی از وظایف واسط مخفی هستند";

/**
 * Synchronizes data-derived CSS classes on every rendered node element:
 * `has-parent` (any input exists), `filter-hidden` (hidden by the
 * done-task filter: completed tasks and fully-done non-root headers),
 * `parent-hidden` (direct primary parent hidden by the done-task filter),
 * `cancelled` and `suspended`.
 *
 * @returns {void}
 */
function syncNodeClasses() {
  state.nodes.forEach((node) => {
    const el = getRenderedEl(node.id);
    if (!el) return;
    el.classList.toggle("has-parent", nodeParentIds(node).length > 0);
    el.classList.toggle("filter-hidden", isNodeHidden(node));
    const parent = node.parent
      ? state.nodes.find((n) => String(n.id) === String(node.parent))
      : null;
    el.classList.toggle("parent-hidden", !!parent && isNodeHidden(parent));
    el.classList.toggle("cancelled", node.type === "task" && !!node.cancelled);
    el.classList.toggle("suspended", node.type === "task" && !!node.suspended);
  });
}

/**
 * Walks up the primary-parent chain from `node` and returns the closest
 * node that is not hidden by the done-task filter (completed tasks and
 * fully-done non-root headers; the node itself when visible).
 * Cycle-guarded.
 *
 * @param {object} node Starting node.
 * @returns {object|null} Nearest visible node on the chain, or null.
 */
function nearestVisibleFrom(node) {
  let current = node;
  const guard = new Set();
  while (current && !guard.has(String(current.id))) {
    guard.add(String(current.id));
    if (!isNodeHidden(current)) return current;
    current = current.parent
      ? state.nodes.find((n) => String(n.id) === String(current.parent))
      : null;
  }
  return null;
}

/* ============================================================
 * Projected-thread tooltip
 * ============================================================ */

/** @type {HTMLElement|null} */ let lockTooltipEl = null;
/** @type {boolean} */ let lockTooltipActive = false;

/**
 * Lazily creates the shared tooltip element.
 * @returns {HTMLElement}
 */
function ensureLockTooltip() {
  if (!lockTooltipEl) {
    lockTooltipEl = document.createElement("div");
    lockTooltipEl.className = "lock-tooltip hidden";
    document.body.appendChild(lockTooltipEl);
  }
  return lockTooltipEl;
}

/**
 * Positions the tooltip near the pointer, flipping/clamping it inside the
 * viewport.
 *
 * @param {number} x Pointer viewport X.
 * @param {number} y Pointer viewport Y.
 * @returns {void}
 */
function positionLockTooltip(x, y) {
  if (!lockTooltipEl) return;
  lockTooltipEl.style.left = `${x}px`;
  lockTooltipEl.style.top = `${y - 34}px`;
  const r = lockTooltipEl.getBoundingClientRect();
  if (r.top < 8) lockTooltipEl.style.top = `${y + 20}px`;
  if (r.right > window.innerWidth - 8)
    lockTooltipEl.style.left = `${x - r.width}px`;
  if (r.left < 8) lockTooltipEl.style.left = "8px";
}

/**
 * Keeps the tooltip under the pointer; hides it once the pointer leaves
 * the eye-off icon (the icon is re-created on every redraw).
 *
 * @param {MouseEvent} ev
 * @returns {void}
 */
function lockTooltipMouseMove(ev) {
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  if (el && el.closest(".eye-off-icon")) {
    positionLockTooltip(ev.clientX, ev.clientY);
  } else {
    hideLockTooltip();
  }
}

/**
 * Shows the tooltip at the pointer and starts tracking pointer movement.
 *
 * @param {MouseEvent} ev
 * @returns {void}
 */
function showLockTooltip(ev) {
  const t = ensureLockTooltip();
  t.textContent = PROJECTED_THREAD_TOOLTIP_TEXT;
  t.classList.remove("hidden");
  positionLockTooltip(ev.clientX, ev.clientY);
  if (!lockTooltipActive) {
    lockTooltipActive = true;
    document.addEventListener("mousemove", lockTooltipMouseMove);
  }
}

/**
 * Hides the tooltip and stops tracking the pointer.
 * @returns {void}
 */
function hideLockTooltip() {
  if (lockTooltipActive) {
    lockTooltipActive = false;
    document.removeEventListener("mousemove", lockTooltipMouseMove);
  }
  if (lockTooltipEl) lockTooltipEl.classList.add("hidden");
}

/* ============================================================
 * Eye-off badge
 * ============================================================ */

/**
 * Appends a small "eye-off" badge on a projected thread, close to the
 * child end of the curve. The badge carries a canvas-colored backdrop
 * capsule so the line beneath it looks cut out, and shows the projected
 * tooltip on hover.
 *
 * @param {number} x1 Curve start X (parent side).
 * @param {number} y1 Curve start Y.
 * @param {number} midX Curve control X.
 * @param {number} x2 Curve end X (child side).
 * @param {number} y2 Curve end Y.
 * @returns {void}
 */
function appendEyeOffIcon(x1, y1, midX, x2, y2) {
  const cubicAt = (t) => {
    const u = 1 - t;
    return {
      x:
        u * u * u * x1 +
        3 * u * u * t * midX +
        3 * u * t * t * midX +
        t * t * t * x2,
      y:
        u * u * u * y1 +
        3 * u * u * t * y1 +
        3 * u * t * t * y2 +
        t * t * t * y2,
    };
  };

  let p = null;
  for (let t = 0.98; t >= 0.55; t -= 0.01) {
    const q = cubicAt(t);
    if (Math.abs(q.x - x2) >= 26 && q.x <= x1 - 18) {
      p = q;
      break;
    }
  }
  if (!p) p = cubicAt(0.6);

  const cx = p.x;
  const cy = p.y;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "eye-off-icon");

  const hit = document.createElementNS(SVG_NS, "rect");
  hit.setAttribute("x", cx - 13);
  hit.setAttribute("y", cy - 11);
  hit.setAttribute("width", 26);
  hit.setAttribute("height", 22);
  hit.setAttribute("fill", "transparent");
  g.appendChild(hit);

  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("class", "eye-bg");
  bg.setAttribute("x", cx - 12);
  bg.setAttribute("y", cy - 7);
  bg.setAttribute("width", 24);
  bg.setAttribute("height", 14);
  bg.setAttribute("rx", 7);
  g.appendChild(bg);

  const eye = document.createElementNS(SVG_NS, "path");
  eye.setAttribute("class", "eye-outline");
  eye.setAttribute(
    "d",
    `M ${cx - 7} ${cy} C ${cx - 3.5} ${cy - 4.5}, ${cx + 3.5} ${cy - 4.5}, ${cx + 7} ${cy} C ${cx + 3.5} ${cy + 4.5}, ${cx - 3.5} ${cy + 4.5}, ${cx - 7} ${cy} Z`,
  );
  g.appendChild(eye);

  const pupil = document.createElementNS(SVG_NS, "circle");
  pupil.setAttribute("class", "eye-pupil");
  pupil.setAttribute("cx", cx);
  pupil.setAttribute("cy", cy);
  pupil.setAttribute("r", 1.7);
  g.appendChild(pupil);

  const slash = document.createElementNS(SVG_NS, "line");
  slash.setAttribute("class", "eye-slash");
  slash.setAttribute("x1", cx - 7);
  slash.setAttribute("y1", cy - 7);
  slash.setAttribute("x2", cx + 7);
  slash.setAttribute("y2", cy + 7);
  g.appendChild(slash);

  g.addEventListener("mouseenter", showLockTooltip);
  g.addEventListener("mouseleave", hideLockTooltip);

  dom.svgLayer.appendChild(g);
}

/* ============================================================
 * Thread-replacement highlight
 * ============================================================ */

/** @type {SVGPathElement|null} */ let hoveredThreadPath = null;

/**
 * Returns the currently highlighted thread path, if any.
 * @returns {SVGPathElement|null}
 */
export function getHighlightedThread() {
  return hoveredThreadPath;
}

/**
 * Highlights a thread as the target of an in-flight replacement (yellow).
 * Replaces any previous highlight; invalid elements are ignored.
 *
 * @param {SVGPathElement|null} path Thread path element (or null to clear).
 * @returns {void}
 */
export function highlightThread(path) {
  clearThreadHighlight();
  if (path && path.classList && path.classList.contains("connection-line")) {
    hoveredThreadPath = path;
    hoveredThreadPath.classList.add("thread-target");
  }
}

/**
 * Removes the replacement highlight, if any.
 * @returns {void}
 */
export function clearThreadHighlight() {
  if (hoveredThreadPath) {
    hoveredThreadPath.classList.remove("thread-target");
    hoveredThreadPath = null;
  }
}

/* ============================================================
 * Rendering
 * ============================================================ */

/**
 * Coalesces redraw requests into at most one per animation frame.
 * @returns {void}
 */
export function requestDraw() {
  if (!state.isDrawing) {
    state.isDrawing = true;
    requestAnimationFrame(() => {
      drawConnections();
      state.isDrawing = false;
    });
  }
}

/**
 * Repaints every connection thread of the active page on the SVG layer.
 *
 * - One thread per input (primary parent + every extra parent).
 * - Hidden nodes (completed tasks and fully-done non-root headers, see
 *   {@link isNodeHidden}) are skipped entirely.
 * - The thread currently being dragged is omitted until the drag ends.
 * - Threads whose real source is hidden are drawn from the nearest
 *   visible ancestor instead, as solid "projected" lines carrying the
 *   eye-off badge (the real source id stays in `data-parent`).
 * - Every visible thread also gets an invisible 14px-wide hit path
 *   (`thread-hit`) carrying `data-parent`/`data-child` for the delegated
 *   grab handling in drag.js.
 *
 * @returns {void}
 */
export function drawConnections() {
  syncNodeClasses();
  clearThreadHighlight();

  dom.svgLayer.innerHTML = "";
  const canvasRect = dom.canvas.getBoundingClientRect();

  state.nodes.forEach((node) => {
    if (!isActivePageNode(node)) return;
    if (isNodeHidden(node)) return;

    nodeParentIds(node).forEach((inputId) => {
      if (
        state.dragData?.type === "move-connection" &&
        String(state.dragData.targetNode.id) === String(node.id) &&
        String(state.dragData.sourceNode.id) === String(inputId)
      )
        return;

      const inputParent = state.nodes.find(
        (n) => String(n.id) === String(inputId),
      );
      if (!inputParent) return;

      const from = nearestVisibleFrom(inputParent);
      if (!from) return;

      const isProjection = String(from.id) !== String(inputParent.id);

      const parentEl = getRenderedEl(from.id);
      const childEl = getRenderedEl(node.id);
      if (!parentEl || !childEl) return;

      const pCp = parentEl.querySelector(".cp-left");
      const cCp = childEl.querySelector(".cp-right");
      if (!pCp || !cCp) return;

      const pRect = pCp.getBoundingClientRect();
      const cRect = cCp.getBoundingClientRect();
      const x1 = pRect.left - canvasRect.left + 4;
      const y1 = pRect.top - canvasRect.top + 4;
      const x2 = cRect.left - canvasRect.left + 4;
      const y2 = cRect.top - canvasRect.top + 4;
      const midX = (x1 + x2) / 2;

      const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute(
        "class",
        isProjection ? "connection-line projected" : "connection-line",
      );
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("data-parent", String(inputParent.id));
      path.setAttribute("data-child", String(node.id));
      dom.svgLayer.appendChild(path);

      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("class", "thread-hit");
      hit.setAttribute("d", d);
      hit.setAttribute("fill", "none");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "14");
      hit.setAttribute("data-parent", String(inputParent.id));
      hit.setAttribute("data-child", String(node.id));
      dom.svgLayer.appendChild(hit);

      if (isProjection) {
        appendEyeOffIcon(x1, y1, midX, x2, y2);
      }
    });
  });
}
