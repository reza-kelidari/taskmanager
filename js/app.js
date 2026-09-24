/**
 * @module app
 * @description Application entry point: wires canvas pointer events,
 * applies history states (undo/redo), owns the misc actions (dark mode,
 * export) and boots the application.
 */
import { state } from "./state.js";
import { dom, positionHoverBox } from "./dom.js";
import {
  showToast,
  getShamsiDate,
  shouldShowHoverBox,
  finite,
} from "./utils.js";
import { errorReporter } from "./error.js";
import { initDB, saveNode, loadNodes, deleteNodeDB } from "./db.js";
import { history } from "./history.js";
import { renderNodes } from "./renderer.js";
import { showHoverBox } from "./hover.js";
import {
  handleNodeMouseDown,
  handlePortMouseDown,
  handleSvgLayerMouseDown,
} from "./drag.js";
import { drawConnections } from "./connections.js";
import { autoArrange, scrubPositions } from "./arrange.js";
import { ensurePages, updateEmptyState } from "./pages.js";
import { setupEvents } from "./events.js";

/**
 * Wires canvas-level listeners: node/port presses and the delegated
 * thread-grab handler on the SVG layer.
 *
 * @returns {void}
 */
function setupCanvasEvents() {
  dom.canvas.addEventListener("mousedown", handleCanvasMouseDown);
  dom.canvas.addEventListener("mouseover", handleCanvasMouseOver);
  dom.canvas.addEventListener("mousemove", handleCanvasMouseMove);
  dom.canvas.addEventListener("mouseout", handleCanvasMouseOut);
  dom.svgLayer.addEventListener("mousedown", handleSvgLayerMouseDown);
}

/**
 * Canvas mousedown: dispatches to the port handler (connection points)
 * or the node-move handler.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
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

/**
 * Shows the hover box when the pointer enters a task node.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
function handleCanvasMouseOver(e) {
  const nodeEl = e.target.closest(".node");
  if (!nodeEl) return;

  const node = state.nodes.find((n) => n.id === nodeEl.dataset.id);
  if (node?.type === "task" && !shouldShowHoverBox()) {
    showHoverBox(node, e);
  }
}

/**
 * Keeps the hover box under the pointer while it stays on a node.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
function handleCanvasMouseMove(e) {
  const nodeEl = e.target.closest(".node");
  if (nodeEl) {
    positionHoverBox(e.clientX, e.clientY);
  }
}

/**
 * Hides the hover box when the pointer leaves a node entirely.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
function handleCanvasMouseOut(e) {
  const nodeEl = e.target.closest(".node");
  if (!nodeEl) return;

  if (!nodeEl.contains(e.relatedTarget)) {
    dom.hoverBox.classList.add("hidden");
  }
}

/**
 * Applies a history snapshot as the current state: deletes nodes absent
 * from the snapshot, normalizes notes/extra-parents/page assignment,
 * snaps coordinates to pixels and re-renders.
 *
 * @param {Array<object>} nodesState Snapshot to apply.
 * @returns {void}
 */
function applyState(nodesState) {
  const keepIds = new Set(nodesState.map((n) => n.id));
  state.nodes.forEach((n) => {
    if (!keepIds.has(n.id)) deleteNodeDB(n.id);
  });

  state.nodes = nodesState;
  state.nodes.forEach((node) => {
    if (!node.notes) node.notes = [];
    if (!Array.isArray(node.extraParents)) node.extraParents = [];
    if (node.parent == null && node.extraParents.length > 0) {
      node.parent = node.extraParents.shift();
    }
    if (node.pageId == null && node.boardId != null) {
      node.pageId = node.boardId;
    }
    delete node.boardId;
    if (node.pageId == null) node.pageId = state.activePageId;
    if (finite(node.x)) node.x = Math.round(node.x);
    if (finite(node.y)) node.y = Math.round(node.y);
    saveNode(node);
  });
  renderNodes();
  drawConnections();

  updateEmptyState();
}

/**
 * Steps one entry back in history and applies it.
 *
 * @returns {void}
 */
function undo() {
  const prevState = history.undo();
  if (prevState) {
    applyState(prevState);
    showToast("بازگشت انجام شد", "info");
  }
}

/**
 * Steps one entry forward in history and applies it.
 *
 * @returns {void}
 */
function redo() {
  const nextState = history.redo();
  if (nextState) {
    applyState(nextState);
    showToast("انجام مجدد", "info");
  }
}

/**
 * Toggles dark mode and persists the preference.
 *
 * @returns {void}
 */
function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem(
    "darkMode",
    document.body.classList.contains("dark-mode"),
  );
}

/**
 * Exports the current graph (pages + nodes) as a dated JSON download.
 *
 * @returns {void}
 */
function exportData() {
  try {
    const data = {
      version: 3,
      exportDate: new Date().toISOString(),
      pages: state.pages,
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

/**
 * Boots the application: restores preferences (dark mode and the done
 * filter — the filter must be applied *before* the first render so
 * projected threads draw correctly), loads and sanitizes persisted nodes,
 * ensures pages (migrating legacy nodes onto the first page), restores
 * or seeds history, and wires all event modules.
 *
 * @returns {Promise<void>}
 */
async function init() {
  try {
    dom.dateDisplay.innerText = getShamsiDate();

    if (localStorage.getItem("darkMode") === "true") {
      document.body.classList.add("dark-mode");
    }

    if (localStorage.getItem("filterActive") === "true") {
      document.body.classList.add("filter-active");
    }

    await initDB();
    state.nodes = await loadNodes();
    state.nodes.forEach((node) => {
      if (!node.notes) node.notes = [];
      if (!Array.isArray(node.extraParents)) node.extraParents = [];
      if (node.parent == null && node.extraParents.length > 0) {
        node.parent = node.extraParents.shift();
      }
    });

    await ensurePages();

    scrubPositions(state.nodes);

    updateEmptyState();
    renderNodes();
    drawConnections();

    const historyRestored = await history.load();
    if (!historyRestored) {
      history.push(state.nodes, "شروع");
    }

    window.__applyHistoryState = applyState;
    setupCanvasEvents();
    setupEvents({
      renderNodes,
      autoArrange,
      undo,
      redo,
      toggleDarkMode,
      exportData,
    });
  } catch (error) {
    errorReporter.report(error, { context: "init" });
    showToast("خطا در راه‌اندازی", "error");
  }
}

init();
