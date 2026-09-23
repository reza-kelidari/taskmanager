import { state } from "./state.js";
import { dom } from "./dom.js";
import { CONFIG } from "./config.js";
import { canConnect, showToast } from "./utils.js";
import { getRenderedEl, renderNodes } from "./renderer.js";
import { history } from "./history.js";
import { saveNode, setNodeDoneStatus } from "./db.js";
import { errorReporter } from "./error.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LOCK_TOOLTIP_TEXT = "برخی از وظایف واسط مخفی هستند";

// ============================================================
// Helpers
// ============================================================

function isNodeHidden(node) {
  return (
    document.body.classList.contains("filter-active") &&
    node.type === "task" &&
    !!node.done
  );
}

function syncHasParentClasses() {
  state.nodes.forEach((node) => {
    const el = getRenderedEl(node.id);
    if (!el) return;
    el.classList.toggle("has-parent", !!node.parent);
    const parent = node.parent
      ? state.nodes.find((n) => String(n.id) === String(node.parent))
      : null;
    el.classList.toggle("parent-hidden", !!parent && isNodeHidden(parent));
  });
}

function nearestVisibleAncestor(node) {
  let currentId = node.parent;
  const guard = new Set();
  while (currentId && !guard.has(String(currentId))) {
    guard.add(String(currentId));
    const p = state.nodes.find((n) => String(n.id) === String(currentId));
    if (!p) return null;
    if (!isNodeHidden(p)) return p;
    currentId = p.parent;
  }
  return null;
}

// ============================================================
// Lock Tooltip (برای اتصال‌های نمایشی)
// ============================================================

let lockTooltipEl = null;
let lockTooltipActive = false;

function ensureLockTooltip() {
  if (!lockTooltipEl) {
    lockTooltipEl = document.createElement("div");
    lockTooltipEl.className = "lock-tooltip hidden";
    document.body.appendChild(lockTooltipEl);
  }
  return lockTooltipEl;
}

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

function lockTooltipMouseMove(ev) {
  const el = document.elementFromPoint(ev.clientX, ev.clientY);
  if (el && el.closest(".lock-icon")) {
    positionLockTooltip(ev.clientX, ev.clientY);
  } else {
    hideLockTooltip();
  }
}

function showLockTooltip(ev) {
  const t = ensureLockTooltip();
  t.textContent = LOCK_TOOLTIP_TEXT;
  t.classList.remove("hidden");
  positionLockTooltip(ev.clientX, ev.clientY);
  if (!lockTooltipActive) {
    lockTooltipActive = true;
    document.addEventListener("mousemove", lockTooltipMouseMove);
  }
}

function hideLockTooltip() {
  if (lockTooltipActive) {
    lockTooltipActive = false;
    document.removeEventListener("mousemove", lockTooltipMouseMove);
  }
  if (lockTooltipEl) lockTooltipEl.classList.add("hidden");
}

// ============================================================
// Lock Icon (روی اتصال نمایشی، نزدیک نود فرزند)
// ============================================================

function appendLockIcon(x1, y1, midX, x2, y2) {
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
  g.setAttribute("class", "lock-icon");

  const hit = document.createElementNS(SVG_NS, "rect");
  hit.setAttribute("x", cx - 10);
  hit.setAttribute("y", cy - 10);
  hit.setAttribute("width", 20);
  hit.setAttribute("height", 20);
  hit.setAttribute("fill", "transparent");
  g.appendChild(hit);

  const body = document.createElementNS(SVG_NS, "rect");
  body.setAttribute("class", "lock-body");
  body.setAttribute("x", cx - 4);
  body.setAttribute("y", cy - 2);
  body.setAttribute("width", 8);
  body.setAttribute("height", 6.5);
  body.setAttribute("rx", 1.5);
  g.appendChild(body);

  const shackle = document.createElementNS(SVG_NS, "path");
  shackle.setAttribute("class", "lock-shackle");
  shackle.setAttribute("d", `M ${cx - 2} ${cy - 2} v -2 a 2 2 0 0 1 4 0 v 2`);
  g.appendChild(shackle);

  g.addEventListener("mouseenter", showLockTooltip);
  g.addEventListener("mouseleave", hideLockTooltip);

  dom.svgLayer.appendChild(g);
}

// ============================================================
// Main Drag Handlers
// ============================================================

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

// ============================================================
// Drag Movement
// ============================================================

function handleDrag(e) {
  if (!state.dragData) return;

  if (state.dragData.type === "move-node") {
    handleNodeDrag(e);
  } else {
    handleConnectionDrag(e);
  }
}

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
  requestDraw();
}

// ============================================================
// Connection Drag (visual line)
// ============================================================

function handleConnectionDrag(e) {
  if (!state.dragData.tempLine) {
    if (state.dragData.type === "move-connection") drawConnections();
    state.dragData.tempLine = document.createElementNS(SVG_NS, "path");
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
  let isConnectable = false;

  if (targetEl) {
    const targetId = targetEl.dataset.id;
    const targetNode = state.nodes.find((n) => n.id == targetId);
    if (targetNode && !isNodeHidden(targetNode)) {
      if (state.dragData.type === "new-connection") {
        isConnectable = canConnect(state.dragData.sourceNode, targetNode);
      } else if (state.dragData.type === "move-connection") {
        isConnectable = canConnect(targetNode, state.dragData.targetNode);
      }
    }
  }

  state.dragData.tempLine.setAttribute(
    "stroke",
    isConnectable
      ? "#007bff"
      : state.dragData.type === "new-connection"
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

// ============================================================
// Drag End
// ============================================================

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
  }
}

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

function handleConnectionDragEnd(e) {
  if (state.dragData.tempLine) {
    state.dragData.tempLine.style.visibility = "hidden";
  }

  const elementUnderMouse = document.elementFromPoint(e.clientX, e.clientY);
  const targetEl = elementUnderMouse
    ? elementUnderMouse.closest(".node")
    : null;

  state.dragData.tempLine.remove();

  if (targetEl) {
    const targetId = targetEl.dataset.id;
    const targetNode = state.nodes.find((n) => n.id == targetId);

    if (targetNode && !isNodeHidden(targetNode)) {
      if (canConnect(state.dragData.sourceNode, targetNode)) {
        if (state.dragData.type === "move-connection") {
          state.dragData.targetNode.parent = null;
          saveNode(state.dragData.targetNode);
        }
        targetNode.parent = state.dragData.sourceNode.id;
        saveNode(targetNode);
        if (state.dragData.sourceNode.type === "task") {
          setNodeDoneStatus(state.dragData.sourceNode, true);
        }
        history.push(state.nodes, "اتصال گره");
      }
    }
  } else if (state.dragData.type === "move-connection") {
    state.dragData.targetNode.parent = null;
    saveNode(state.dragData.targetNode);
    history.push(state.nodes, "قطع اتصال");
  }

  renderNodes();
}

// ============================================================
// Overlap Resolution
// ============================================================

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

// ============================================================
// Drawing
// ============================================================

export function requestDraw() {
  if (!state.isDrawing) {
    state.isDrawing = true;
    requestAnimationFrame(() => {
      drawConnections();
      state.isDrawing = false;
    });
  }
}

export function drawConnections() {
  syncHasParentClasses();

  dom.svgLayer.innerHTML = "";
  const canvasRect = dom.canvas.getBoundingClientRect();

  state.nodes.forEach((node) => {
    if (!node.parent) return;
    if (
      state.dragData?.type === "move-connection" &&
      state.dragData.targetNode.id === node.id
    )
      return;
    if (isNodeHidden(node)) return;

    const parent = nearestVisibleAncestor(node);
    if (!parent) return;

    const isProjection = String(node.parent) !== String(parent.id);

    const parentEl = getRenderedEl(parent.id);
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

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute(
      "class",
      isProjection ? "connection-line projected" : "connection-line",
    );
    path.setAttribute(
      "d",
      `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#ccc");
    path.setAttribute("stroke-width", "2");
    dom.svgLayer.appendChild(path);

    if (isProjection) {
      appendLockIcon(x1, y1, midX, x2, y2);
    }
  });
}
