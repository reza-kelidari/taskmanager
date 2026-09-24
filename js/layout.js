/**
 * @module layout
 * @description Recursive tree layout. Children are placed one level to the
 * left of their parent; each parent is vertically centered on the *actual
 * rendered position* of its first child so the entire first-child chain
 * shares one center axis regardless of mixed node heights.
 */
import { state } from "./state.js";
import { CONFIG } from "./config.js";
import { getRenderedEl } from "./renderer.js";

/**
 * Lays out the subtree rooted at `node`, assigning `x`/`y` in place and
 * snapping every coordinate to whole pixels (fractional CSS pixels round
 * inconsistently across browsers and cause visible 1–2px drift).
 *
 * Centering note: the parent's center is computed from
 * `children[0].y` — the *actual* position the recursive call assigned to
 * the first child — not from the `y` slot the subtree started at. When the
 * first child has children of its own, its own centering pushes it below
 * its starting slot, and centering the parent on the starting slot would
 * misalign the chain by half the height difference.
 *
 * @param {object} node Subtree root (mutated).
 * @param {number} x Left coordinate for this node (canvas space).
 * @param {number} y Top slot coordinate for this subtree (canvas space).
 * @returns {{minY: number, maxY: number}} Vertical extent of the subtree.
 */
export function layoutTree(node, x, y) {
  const el = getRenderedEl(node.id);
  const h = el ? el.offsetHeight : CONFIG.FALLBACK_HEIGHT;
  node.x = Math.round(x);

  const children = state.nodes.filter((n) => n.parent === node.id);

  if (children.length === 0) {
    node.y = Math.round(y);
    return { minY: node.y, maxY: node.y + h };
  }

  let currentY = y;
  let totalMaxY = -Infinity;
  let firstH = CONFIG.FALLBACK_HEIGHT;

  children.forEach((child, idx) => {
    const childEl = getRenderedEl(child.id);
    const childW = childEl ? childEl.offsetWidth : CONFIG.FALLBACK_WIDTH;
    if (idx === 0) {
      firstH = childEl ? childEl.offsetHeight : CONFIG.FALLBACK_HEIGHT;
    }
    const childBounds = layoutTree(
      child,
      node.x - CONFIG.GAP - childW,
      currentY,
    );
    currentY = childBounds.maxY + CONFIG.VERTICAL_GAP;
    totalMaxY = Math.max(totalMaxY, childBounds.maxY);
  });

  const first = children[0];
  node.y = Math.round(first.y + firstH / 2 - h / 2);

  return {
    minY: Math.min(node.y, Math.round(y)),
    maxY: Math.max(node.y + h, totalMaxY),
  };
}
