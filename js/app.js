import { state } from "./state.js";
import { dom, positionHoverBox } from "./dom.js";
import { CONFIG } from "./config.js";
import { showToast, getShamsiDate, shouldShowHoverBox } from "./utils.js";
import { errorReporter } from "./error.js";
import { initDB, saveNode, loadNodes } from "./db.js";
import { history } from "./history.js";
import { renderNodes, getRenderedEl } from "./renderer.js";
import { showHoverBox } from "./hover.js";
import {
  handleNodeMouseDown,
  handlePortMouseDown,
  drawConnections,
} from "./drag.js";
import { layoutTree } from "./layout.js";
import { setupEvents } from "./events.js";

// ============================================================
// Canvas Events
// ============================================================

function setupCanvasEvents() {
  dom.canvas.addEventListener("mousedown", handleCanvasMouseDown);
  dom.canvas.addEventListener("mouseover", handleCanvasMouseOver);
  dom.canvas.addEventListener("mousemove", handleCanvasMouseMove);
  dom.canvas.addEventListener("mouseout", handleCanvasMouseOut);
}

function handleCanvasMouseDown(e) {
  const nodeEl = e.target.closest(".node");
  if (!nodeEl) return;

  if (e.target.classList.contains("connection-point")) {
    e.stopPropagation();
    e.preventDefault();
    const node = state.nodes.find((n) => n.id === nodeEl.dataset.id);
    if (node) {
      const portType = e.target.classList.contains("cp-left")
        ? "left"
        : "right";
      handlePortMouseDown(e, node, portType);
    }
    return;
  }

  const node = state.nodes.find((n) => n.id === nodeEl.dataset.id);
  if (node) handleNodeMouseDown(e, node);
}

function handleCanvasMouseOver(e) {
  const nodeEl = e.target.closest(".node");
  if (!nodeEl) return;

  const node = state.nodes.find((n) => n.id === nodeEl.dataset.id);
  if (node?.type === "task" && !shouldShowHoverBox()) {
    showHoverBox(node, e);
  }
}

function handleCanvasMouseMove(e) {
  const nodeEl = e.target.closest(".node");
  if (nodeEl) {
    positionHoverBox(e.clientX, e.clientY);
  }
}

function handleCanvasMouseOut(e) {
  const nodeEl = e.target.closest(".node");
  if (!nodeEl) return;

  if (!nodeEl.contains(e.relatedTarget)) {
    dom.hoverBox.classList.add("hidden");
  }
}

// ============================================================
// Auto Arrange
// ============================================================

function autoArrange() {
  renderNodes();
  const oldPos = {};
  state.nodes.forEach((n) => (oldPos[n.id] = { x: n.x, y: n.y }));

  const roots = state.nodes.filter((n) => !n.parent);

  if (roots.length === 0) {
    panCanvas(window.innerWidth / 2, window.innerHeight / 2);
    return;
  }

  let currentY = CONFIG.CANVAS_INITIAL_Y_OFFSET;
  roots.forEach((root) => {
    const bounds = layoutTree(root, 300, currentY);
    currentY = bounds.maxY + 25.7;
  });

  state.nodes.forEach(saveNode);
  history.push(state.nodes);

  const { minX, minY, maxX, maxY } = computeBounds();
  const canvasPanned = maybeAutoPan(minX, minY, maxX, maxY);

  state.nodes.forEach((node) => {
    const el = getRenderedEl(node.id);
    if (el) {
      el.style.left = `${oldPos[node.id].x}px`;
      el.style.top = `${oldPos[node.id].y}px`;
    }
  });

  void dom.canvas.offsetWidth;

  state.nodes.forEach((node) => {
    const el = getRenderedEl(node.id);
    if (el) {
      el.classList.add("smooth-arrange");
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
    }
  });

  const start = performance.now();
  function animateLoop(now) {
    drawConnections();
    if (now - start < CONFIG.ANIMATION_DURATION) {
      requestAnimationFrame(animateLoop);
    } else {
      state.nodes.forEach((node) => {
        const el = getRenderedEl(node.id);
        if (el) el.classList.remove("smooth-arrange");
      });
      if (canvasPanned) dom.canvas.style.transition = "";
    }
  }
  requestAnimationFrame(animateLoop);
}

function computeBounds() {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  state.nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    const el = getRenderedEl(node.id);
    const w = el ? el.offsetWidth : CONFIG.FALLBACK_WIDTH;
    const h = el ? el.offsetHeight : CONFIG.FALLBACK_HEIGHT;
    maxX = Math.max(maxX, node.x + w);
    maxY = Math.max(maxY, node.y + h);
  });
  return { minX, minY, maxX, maxY };
}

function maybeAutoPan(minX, minY, maxX, maxY) {
  const cLeft = parseInt(dom.canvas.style.left || 0);
  const cTop = parseInt(dom.canvas.style.top || 0);
  const isFullyOutside = !(
    cLeft + maxX > 0 &&
    cLeft + minX < window.innerWidth &&
    cTop + maxY > 0 &&
    cTop + minY < window.innerHeight
  );

  if (isFullyOutside && !isNaN(minX)) {
    const newLeft = window.innerWidth * 0.75 - maxX;
    const newTop = window.innerHeight * 0.35 - minY;
    panCanvas(newLeft, newTop, true);
    return true;
  }
  return false;
}

function panCanvas(x, y, withTransition = true) {
  if (withTransition)
    dom.canvas.style.transition = "left 0.3s ease, top 0.3s ease";
  dom.canvas.style.left = `${x}px`;
  dom.canvas.style.top = `${y}px`;
  localStorage.setItem("canvasX", x);
  localStorage.setItem("canvasY", y);
  if (withTransition) {
    setTimeout(() => {
      dom.canvas.style.transition = "";
    }, CONFIG.ANIMATION_DURATION);
  }
}

// ============================================================
// Undo / Redo
// ============================================================

function applyState(nodesState) {
  state.nodes = nodesState;
  state.nodes.forEach((node) => {
    if (!node.notes) node.notes = [];
    saveNode(node);
  });
  renderNodes();
  drawConnections();
}

function undo() {
  const prevState = history.undo();
  if (prevState) {
    applyState(prevState);
    showToast("بازگشت انجام شد", "info");
  }
}

function redo() {
  const nextState = history.redo();
  if (nextState) {
    applyState(nextState);
    showToast("انجام مجدد", "info");
  }
}

// ============================================================
// Misc
// ============================================================

function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem(
    "darkMode",
    document.body.classList.contains("dark-mode"),
  );
}

function exportData() {
  try {
    const data = {
      version: 1,
      exportDate: new Date().toISOString(),
      nodes: state.nodes,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tasks_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("خروجی ذخیره شد", "success");
  } catch (error) {
    errorReporter.report(error, { context: "exportData" });
    showToast("خطا در خروجی", "error");
  }
}

// ============================================================
// Init
// ============================================================

async function init() {
  try {
    dom.dateDisplay.innerText = getShamsiDate();

    if (localStorage.getItem("darkMode") === "true") {
      document.body.classList.add("dark-mode");
    }

    await initDB();
    state.nodes = await loadNodes();
    state.nodes.forEach((node) => {
      if (!node.notes) node.notes = [];
    });

    if (state.nodes.length === 0) {
      dom.emptyState.style.display = "block";
    } else {
      dom.emptyState.style.display = "none";
      renderNodes();
      drawConnections();
    }

    history.push(state.nodes);
    setupCanvasEvents();
    setupEvents(
      renderNodes,
      autoArrange,
      undo,
      redo,
      toggleDarkMode,
      exportData,
    );
  } catch (error) {
    errorReporter.report(error, { context: "init" });
    showToast("خطا در راه‌اندازی", "error");
  }
}

init();
