/**
 * @module renderer
 * @description Minimal virtual-DOM renderer for canvas nodes. Creates,
 * updates and removes node elements, diffing by id and preserving
 * connection-point elements across header title rewrites.
 */
import { state } from "./state.js";
import { dom } from "./dom.js";
import { errorReporter, perfMonitor } from "./error.js";
import { isNodeHidden } from "./utils.js";

/**
 * Keeps a map of rendered node elements in sync with `state.nodes`.
 */
class VirtualRenderer {
  constructor() {
    /** @type {Map<string, {element: HTMLElement, node: object}>} */
    this.renderedNodes = new Map();
  }

  /**
   * Reconciles the DOM with the given node list: removes stale elements,
   * updates existing ones and creates missing ones.
   *
   * @param {Array<object>} nodes Current node graph.
   * @returns {void}
   */
  render(nodes) {
    try {
      perfMonitor.measure("render", () => {
        const currentIds = new Set(nodes.map((n) => n.id));

        for (const [id, { element }] of this.renderedNodes) {
          if (!currentIds.has(id)) {
            element.remove();
            this.renderedNodes.delete(id);
          }
        }

        nodes.forEach((node) => {
          if (this.renderedNodes.has(node.id)) this.updateNode(node.id, node);
          else this.createNode(node.id, node);
        });
      });
    } catch (error) {
      errorReporter.report(error, { context: "VirtualRenderer.render" });
    }
  }

  /**
   * Creates and registers a new node element.
   *
   * @param {string} id Node id.
   * @param {object} node Node data.
   * @returns {void}
   */
  createNode(id, node) {
    const el = document.createElement("div");
    el.className = `node ${node.type}`;
    el.dataset.id = node.id;
    this.applyNodeStyles(el, node);
    dom.canvas.appendChild(el);
    this.renderedNodes.set(id, { element: el, node });
  }

  /**
   * Refreshes an already-rendered node element.
   *
   * @param {string} id Node id.
   * @param {object} node Node data.
   * @returns {void}
   */
  updateNode(id, node) {
    const cached = this.renderedNodes.get(id);
    if (!cached) return;
    this.applyNodeStyles(cached.element, node);
    cached.node = node;
  }

  /**
   * Applies position, state classes, title/label and connection points to
   * a node element. Also syncs the `filter-hidden` class from
   * {@link isNodeHidden} (done-task filter). Header elements rewrite their
   * text content, so their connection points are detached and re-attached
   * to survive it.
   *
   * @param {HTMLElement} el Node element.
   * @param {object} node Node data.
   * @returns {void}
   */
  applyNodeStyles(el, node) {
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.classList.toggle("filter-hidden", isNodeHidden(node));

    if (node.parent) {
      el.classList.add("has-parent");
    } else {
      el.classList.remove("has-parent");
    }

    if (node.type === "header") {
      const cpLeft = el.querySelector(".cp-left");
      const cpRight = el.querySelector(".cp-right");
      el.textContent = node.title;
      if (cpLeft) el.appendChild(cpLeft);
      if (cpRight) el.appendChild(cpRight);
    } else {
      if (node.done) {
        el.classList.add("done");
      } else {
        el.classList.remove("done");
      }

      let label = el.querySelector(".task-label");
      if (!label) {
        label = document.createElement("div");
        label.className = "task-label";
        el.appendChild(label);
      }
      label.textContent = node.title;
    }

    if (!el.querySelector(".cp-left")) {
      const cpLeft = document.createElement("div");
      cpLeft.className = "connection-point cp-left";
      el.appendChild(cpLeft);
    }
    if (!el.querySelector(".cp-right")) {
      const cpRight = document.createElement("div");
      cpRight.className = "connection-point cp-right";
      el.appendChild(cpRight);
    }
  }

  /**
   * Removes every rendered element and clears the cache.
   * @returns {void}
   */
  clear() {
    this.renderedNodes.forEach(({ element }) => element.remove());
    this.renderedNodes.clear();
  }
}

export const renderer = new VirtualRenderer();

/**
 * Looks up the currently rendered element of a node.
 *
 * @param {string} nodeId Node id.
 * @returns {HTMLElement|null}
 */
export function getRenderedEl(nodeId) {
  return dom.canvas.querySelector(`.node[data-id="${nodeId}"]`);
}

/**
 * Re-renders the whole in-memory graph.
 * @returns {void}
 */
export function renderNodes() {
  renderer.render(state.nodes);
}
