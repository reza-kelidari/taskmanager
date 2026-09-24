/**
 * @module hover
 * @description The node hover box: shows a task's description and notes
 * on pointer hover.
 */
import { dom, positionHoverBox } from "./dom.js";

/**
 * Renders and reveals the hover box for a node. Does nothing when the
 * node has neither a description nor notes.
 *
 * @param {object} node Task node to describe.
 * @param {MouseEvent} e The triggering mouse event (for positioning).
 * @returns {void}
 */
export function showHoverBox(node, e) {
  const hasDesc = node.note?.trim();
  const notes = node.notes || [];
  if (!hasDesc && notes.length === 0) return;

  dom.hoverBox.innerHTML = "";

  const h4 = document.createElement("h4");
  h4.textContent = node.title;
  dom.hoverBox.appendChild(h4);

  if (hasDesc) {
    const p = document.createElement("p");
    p.textContent = node.note;
    dom.hoverBox.appendChild(p);
  }

  if (notes.length > 0) {
    const spacer = document.createElement("div");
    spacer.style.marginTop = "5px";
    dom.hoverBox.appendChild(spacer);
    notes.forEach((n) => {
      const comment = document.createElement("div");
      comment.className = "comment-item";
      const meta = document.createElement("div");
      meta.className = "note-meta";
      meta.textContent = `${n.date} - ${n.time}`;
      comment.appendChild(meta);
      const text = document.createElement("div");
      text.textContent = n.text;
      comment.appendChild(text);
      dom.hoverBox.appendChild(comment);
    });
  }

  positionHoverBox(e.clientX, e.clientY);
  dom.hoverBox.classList.remove("hidden");
}
