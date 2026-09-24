/**
 * @module drag
 * @description Pointer interactions: node dragging, connection dragging
 * (new threads, thread replacement and detachment), delegated thread
 * grabbing on the SVG layer, and post-drag overlap resolution.
 */
import { state } from "./state.js";
import { dom } from "./dom.js";
import { CONFIG } from "./config.js";
import { canConnect, canConnectRaw, isNodeHidden, showToast } from "./utils.js";
import { getRenderedEl, renderNodes } from "./renderer.js";
import { history } from "./history.js";
import {
  addParentInput,
  removeParentInput,
  replaceParentInput,
  saveNode,
} from "./db.js";
import { errorReporter } from "./error.js";
import {
  drawConnections,
  getHighlightedThread,
  highlightThread,
  clearThreadHighlight,
} from "./connections.js";

/**
 * Delegated mousedown handler for the SVG connection layer: grabbing any
 * thread (its invisible hit path) starts a `move-connection` drag of that
 * exact thread. Projected threads (hidden real source or child) are not
 * grabbable.
 *
 * Attached once by app.js — this replaces per-thread listeners and keeps
 * connections.js render-only.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
export function handleSvgLayerMouseDown(e) {
  if (e.button !== 0) return;
  const hit = e.target.closest(".thread-hit");
  if (!hit) return;

  const parent = state.nodes.find(
    (n) => String(n.id) === String(hit.dataset.parent),
  );
  const child = state.nodes.find(
    (n) => String(n.id) === String(hit.dataset.child),
  );
  if (!parent || !child) return;
  if (isNodeHidden(parent) || isNodeHidden(child)) return;

  state.dragData = {
    type: "move-connection",
    sourceNode: parent,
    targetNode: child,
  };

  document.addEventListener("mousemove", handleDrag);
  document.addEventListener("mouseup", handleDragEnd);
}

/**
 * Starts a node-move drag session.
 *
 * @param {MouseEvent} e Originating event.
 * @param {object} node Node being dragged.
 * @returns {void}
 */
export function handleNodeMouseDown(e, node) {
  if (e.button !== 0 || e.target.classList.contains("connection-point")) return;

  const nodeEl = e.target.closest(".node");
  state.dragData = {
    type: "move-node",
    el: nodeEl,
    startX: e.clientX,
    startY: e.clientY,
    initX: parseInt(nodeEl.style.left),
    initY: parseInt(nodeEl.style.top),
    moved: false,
  };

  document.addEventListener("mousemove", handleDrag);
  document.addEventListener("mouseup", handleDragEnd);
}

/**
 * Starts a connection drag. The left port begins a new thread from this
 * node; the right port grabs the node's primary input thread. Hidden
 * sources cannot be grabbed (projected connection).
 *
 * @param {MouseEvent} e Originating event.
 * @param {object} node Node owning the port.
 * @param {("left"|"right")} portType Port side.
 * @returns {void}
 */
export function handlePortMouseDown(e, node, portType) {
  if (e.button !== 0) return;
  e.stopPropagation();

  if (window.getComputedStyle(e.target).opacity === "0") return;

  if (portType === "left") {
    state.dragData = { type: "new-connection", sourceNode: node };
  } else {
    if (!node.parent) return;
    const sourceNode = state.nodes.find((n) => n.id == node.parent);
    if (!sourceNode) return;
    if (isNodeHidden(sourceNode)) return;
    state.dragData = { type: "move-connection", sourceNode, targetNode: node };
  }

  document.addEventListener("mousemove", handleDrag);
  document.addEventListener("mouseup", handleDragEnd);
}

/**
 * Routes pointer-move events to the active drag session.
 * @param {MouseEvent} e
 * @returns {void}
 */
function handleDrag(e) {
  if (!state.dragData) return;

  if (state.dragData.type === "move-node") {
    handleNodeDrag(e);
  } else {
    handleConnectionDrag(e);
  }
}

/**
 * Moves the dragged node element with the pointer (threshold-gated) and
 * requests a throttled connection redraw.
 * @param {MouseEvent} e
 * @returns {void}
 */
function handleNodeDrag(e) {
  const dx = e.clientX - state.dragData.startX;
  const dy = e.clientY - state.dragData.startY;
  if (
    Math.abs(dx) > CONFIG.MIN_DRAG_THRESHOLD ||
    Math.abs(dy) > CONFIG.MIN_DRAG_THRESHOLD
  ) {
    state.dragData.moved = true;
  }
  if (state.dragData.el) {
    state.dragData.el.style.left = `${state.dragData.initX + dx}px`;
    state.dragData.el.style.top = `${state.dragData.initY + dy}px`;
  }
  requestAnimationFrame(() => drawConnections());
}

/**
 * Draws the in-flight connection line and computes the live drop feedback:
 *
 * - Over a node body: blue when a valid new input; gray (no-op) when
 *   hovering the very child/source the thread was detached from; red when
 *   invalid.
 * - Over a thread: the hovered thread turns yellow (replacement target)
 *   and the line is blue when the source can validly replace it. A thread
 *   cannot be replaced by its own current source, and projected threads
 *   are not replaceable.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
function handleConnectionDrag(e) {
  if (!state.dragData.tempLine) {
    if (state.dragData.type === "move-connection") drawConnections();
    state.dragData.tempLine = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    state.dragData.tempLine.setAttribute("stroke-width", "2");
    state.dragData.tempLine.setAttribute("stroke-dasharray", "5,5");
    state.dragData.tempLine.setAttribute("fill", "none");
    state.dragData.tempLine.style.pointerEvents = "none";
    dom.svgLayer.appendChild(state.dragData.tempLine);
  }

  const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
  const targetEl = elementUnderMouse
    ? elementUnderMouse.closest(".node")
    : null;
  const threadEl = elementUnderMouse
    ? elementUnderMouse.closest(".thread-hit")
    : null;

  let isConnectable = false;
  let isNoOp = false;
  let highlightPath = null;

  if (targetEl) {
    const targetId = targetEl.dataset.id;
    const targetNode = state.nodes.find((n) => n.id == targetId);
    if (targetNode && !isNodeHidden(targetNode)) {
      isConnectable = canConnect(state.dragData.sourceNode, targetNode);

      if (
        !isConnectable &&
        state.dragData.type === "move-connection" &&
        state.dragData.targetNode &&
        (String(targetNode.id) === String(state.dragData.targetNode.id) ||
          String(targetNode.id) === String(state.dragData.sourceNode.id))
      ) {
        isNoOp = true;
      }
    }
  } else if (threadEl) {
    const parentId = threadEl.dataset.parent;
    const childId = threadEl.dataset.child;
    const childNode = state.nodes.find((n) => String(n.id) === String(childId));
    const realParent = state.nodes.find(
      (n) => String(n.id) === String(parentId),
    );
    if (
      childNode &&
      realParent &&
      !isNodeHidden(childNode) &&
      !isNodeHidden(realParent) &&
      String(state.dragData.sourceNode.id) !== String(parentId) &&
      canConnectRaw(state.dragData.sourceNode, childNode)
    ) {
      isConnectable = true;
      highlightPath = threadEl.previousElementSibling;
    }
  }

  if (highlightPath !== getHighlightedThread()) {
    highlightThread(highlightPath);
  }

  state.dragData.tempLine.setAttribute(
    "stroke",
    isConnectable
      ? "#007bff"
      : isNoOp || state.dragData.type === "new-connection"
        ? "#ccc"
        : "#ff0000",
  );

  const canvasRect = dom.canvas.getBoundingClientRect();
  const sourceEl = getRenderedEl(state.dragData.sourceNode.id);
  if (!sourceEl) return;

  const cp = sourceEl.querySelector(".cp-left");
  const cpRect = cp.getBoundingClientRect();
  const x1 = cpRect.left - canvasRect.left + 4;
  const y1 = cpRect.top - canvasRect.top + 4;
  const x2 = e.clientX - canvasRect.left;
  const y2 = e.clientY - canvasRect.top;
  const midX = (x1 + x2) / 2;

  state.dragData.tempLine.setAttribute(
    "d",
    `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
  );
}

/**
 * Finalizes the active drag session: delegates to the node/connection
 * end handler, always redraws (even on failure) and detaches the
 * document-level listeners.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
function handleDragEnd(e) {
  if (!state.dragData) return;

  try {
    if (state.dragData.type === "move-node") {
      handleNodeDragEnd();
    } else if (state.dragData.tempLine) {
      handleConnectionDragEnd(e);
    }
    drawConnections();
  } catch (error) {
    errorReporter.report(error, { context: "handleDragEnd" });
    showToast("خطا در جابجایی", "error");
  } finally {
    state.dragData = null;
    document.removeEventListener("mousemove", handleDrag);
    document.removeEventListener("mouseup", handleDragEnd);
    drawConnections();
  }
}

/**
 * Commits a node move: persists the new position, runs overlap
 * resolution, and records a history entry when the position actually
 * changed.
 *
 * @returns {void}
 */
function handleNodeDragEnd() {
  if (!state.dragData.moved) return;

  const el = state.dragData.el;
  const id = el?.dataset?.id;
  if (!id) return;

  const newX = parseInt(el.style.left);
  const newY = parseInt(el.style.top);
  if (isNaN(newX) || isNaN(newY)) return;

  const node = state.nodes.find((n) => n.id == id);
  if (!node) return;

  const oldX = node.x;
  const oldY = node.y;

  node.x = newX;
  node.y = newY;
  saveNode(node);

  try {
    resolveOverlaps(node);
  } catch (err) {
    errorReporter.report(err, { context: "resolveOverlaps (drag)" });
  }

  if (node.x !== oldX || node.y !== oldY) {
    history.push(state.nodes, `جابجایی «${node.title}»`);
  }
}

/**
 * Commits a connection drag according to the drop target:
 *
 * - Node body → add the source as a new input of that node (duplicates
 *   are rejected by `canConnect`, making the drop a silent no-op).
 * - Thread → replace that exact thread's slot in place.
 * - Empty space with a grabbed thread → detach it.
 *
 * Nothing is recorded in history when nothing changed.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
function handleConnectionDragEnd(e) {
  if (state.dragData.tempLine) {
    state.dragData.tempLine.style.visibility = "hidden";
  }

  const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
  const targetEl = elementUnderMouse
    ? elementUnderMouse.closest(".node")
    : null;
  const threadEl = elementUnderMouse
    ? elementUnderMouse.closest(".thread-hit")
    : null;

  clearThreadHighlight();
  state.dragData.tempLine.remove();

  const source = state.dragData.sourceNode;
  const draggedChild =
    state.dragData.type === "move-connection"
      ? state.dragData.targetNode
      : null;

  let changed = false;
  let label = "اتصال گره";

  if (targetEl) {
    const dropNode = state.nodes.find((n) => n.id == targetEl.dataset.id);
    if (dropNode && !isNodeHidden(dropNode) && canConnect(source, dropNode)) {
      if (draggedChild) removeParentInput(draggedChild, source.id);
      addParentInput(dropNode, source.id);
      changed = true;
    }
  } else if (threadEl) {
    const oldParentId = threadEl.dataset.parent;
    const childId = threadEl.dataset.child;
    const dropNode = state.nodes.find((n) => String(n.id) === String(childId));
    const realParent = state.nodes.find(
      (n) => String(n.id) === String(oldParentId),
    );
    if (
      dropNode &&
      realParent &&
      !isNodeHidden(dropNode) &&
      !isNodeHidden(realParent) &&
      String(source.id) !== String(oldParentId) &&
      canConnectRaw(source, dropNode)
    ) {
      if (draggedChild) removeParentInput(draggedChild, source.id);
      replaceParentInput(dropNode, oldParentId, source.id);
      changed = true;
      label = "جایگزینی اتصال";
    }
  } else if (draggedChild) {
    removeParentInput(draggedChild, source.id);
    changed = true;
    label = "قطع اتصال";
  }

  if (changed) {
    history.push(state.nodes, label);
  }

  renderNodes();
}

/* ============================================================
 * Overlap resolution
 * ============================================================ */

/**
 * Pushes a just-dropped node downward (in `OVERLAP_PUSH_AMOUNT` steps)
 * until it no longer intersects any visible node box or existing
 * connection curve, then animates it into place. Hidden (filtered) nodes
 * never participate.
 *
 * @param {object} movedNode The dropped node (mutated in place).
 * @returns {void}
 */
function resolveOverlaps(movedNode) {
  const originalY = movedNode.y;

  let changed = true;
  let iterations = 0;
  let finalY = movedNode.y;

  while (changed && iterations < CONFIG.MAX_OVERLAP_ITERATIONS) {
    changed = false;
    iterations++;

    const movedEl = getRenderedEl(movedNode.id);
    if (!movedEl) break;

    const mW = movedEl.offsetWidth;
    const mH = movedEl.offsetHeight;
    const mX1 = movedNode.x;
    const mY1 = finalY;
    const mX2 = mX1 + mW;
    const mY2 = mY1 + mH;

    let needsPush = false;

    for (const other of state.nodes) {
      if (other.id === movedNode.id) continue;
      if (isNodeHidden(other)) continue;
      const otherEl = getRenderedEl(other.id);
      if (!otherEl) continue;

      const oW = otherEl.offsetWidth;
      const oH = otherEl.offsetHeight;
      const oX1 = other.x;
      const oY1 = other.y;
      const oX2 = oX1 + oW;
      const oY2 = oY1 + oH;

      if (mX1 < oX2 && mX2 > oX1 && mY1 < oY2 && mY2 > oY1) {
        needsPush = true;
        break;
      }
    }

    if (!needsPush) {
      needsPush = checkCurveOverlap(mX1, mX2, mY1, mY2, movedNode.id);
    }

    if (needsPush) {
      finalY += CONFIG.OVERLAP_PUSH_AMOUNT;
      changed = true;
    }
  }

  const dy = finalY - originalY;
  if (dy !== 0) {
    movedNode.y = finalY;
    saveNode(movedNode);
  }

  renderNodes();

  const newEl = getRenderedEl(movedNode.id);
  if (newEl) {
    newEl.style.top = `${originalY}px`;
    void newEl.offsetHeight;
    newEl.classList.add("smooth-arrange");
    newEl.style.top = `${finalY}px`;

    const start = performance.now();
    function animateLines(now) {
      drawConnections();
      if (now - start < CONFIG.ANIMATION_DURATION)
        requestAnimationFrame(animateLines);
    }
    requestAnimationFrame(animateLines);
    setTimeout(
      () => newEl.classList.remove("smooth-arrange"),
      CONFIG.ANIMATION_DURATION,
    );
  }
}

/**
 * Samples every visible connection curve (5% steps) and reports whether
 * it passes through the given bounding box.
 *
 * @param {number} mX1 Box left.
 * @param {number} mX2 Box right.
 * @param {number} mY1 Box top.
 * @param {number} mY2 Box bottom.
 * @param {string} movedId Id of the moved node (its own threads excluded).
 * @returns {boolean} True when any curve intersects the box.
 */
function checkCurveOverlap(mX1, mX2, mY1, mY2, movedId) {
  for (const node of state.nodes) {
    if (!node.parent || node.id === movedId) continue;
    if (isNodeHidden(node)) continue;

    const parent = state.nodes.find((n) => n.id == node.parent);
    if (!parent || isNodeHidden(parent)) continue;

    const parentEl = getRenderedEl(parent.id);
    const childEl = getRenderedEl(node.id);
    if (!parentEl || !childEl) continue;

    const parentH = parentEl.offsetHeight;
    const childH = childEl.offsetHeight;
    const childW = childEl.offsetWidth;
    const pX = parent.x;
    const pY = parent.y + parentH / 2;
    const cX = node.x + childW;
    const cY = node.y + childH / 2;
    const midX = (pX + cX) / 2;

    let minY = Infinity;
    let maxY = -Infinity;
    let intersectsX = false;

    for (let t = 0; t <= 1; t += 0.05) {
      const u = 1 - t;
      const x =
        u * u * u * pX +
        3 * u * u * t * midX +
        3 * u * t * t * midX +
        t * t * t * cX;
      const y =
        u * u * u * pY +
        3 * u * u * t * pY +
        3 * u * t * t * cY +
        t * t * t * cY;
      if (x >= mX1 && x <= mX2) {
        intersectsX = true;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (intersectsX && maxY >= mY1 && minY <= mY2) return true;
  }
  return false;
}
