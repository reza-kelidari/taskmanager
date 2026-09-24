/**
 * @module hover
 * @description The node hover box: shows a task's description
 * on pointer hover (comments live in the click-to-open details modal).
 */
import { dom, positionHoverBox } from "./dom.js";

/**
 * Renders and reveals the hover box for a node. Does nothing when the
 * node has no description.
 *
 * @param {object} node Task node to describe.
 * @param {MouseEvent} e The triggering mouse event (for positioning).
 * @returns {void}
 */
export function showHoverBox(node, e) {
  const hasDesc = node.note?.trim();
  if (!hasDesc) return;

  dom.hoverBox.innerHTML = "";

  const h4 = document.createElement("h4");
  h4.textContent = node.title;
  dom.hoverBox.appendChild(h4);

  const p = document.createElement("p");
  p.textContent = node.note;
  dom.hoverBox.appendChild(p);

  positionHoverBox(e.clientX, e.clientY);
  dom.hoverBox.classList.remove("hidden");
}
