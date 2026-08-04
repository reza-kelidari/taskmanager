import { state } from "./state.js";
import { dom } from "./dom.js";
import { errorReporter, perfMonitor } from "./error.js";

class VirtualRenderer {
  constructor() {
    this.renderedNodes = new Map();
  }

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

  createNode(id, node) {
    const el = document.createElement("div");
    el.className = `node ${node.type}`;
    el.dataset.id = node.id;
    this.applyNodeStyles(el, node);
    dom.canvas.appendChild(el);
    this.renderedNodes.set(id, { element: el, node });
  }

  updateNode(id, node) {
    const cached = this.renderedNodes.get(id);
    if (!cached) return;
    this.applyNodeStyles(cached.element, node);
    cached.node = node;
  }

  applyNodeStyles(el, node) {
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

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

  clear() {
    this.renderedNodes.forEach(({ element }) => element.remove());
    this.renderedNodes.clear();
  }
}

export const renderer = new VirtualRenderer();

export function getRenderedEl(nodeId) {
  return dom.canvas.querySelector(`.node[data-id="${nodeId}"]`);
}

export function renderNodes() {
  renderer.render(state.nodes);
}
