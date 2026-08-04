import { state } from "./state.js";
import { CONFIG } from "./config.js";
import { getRenderedEl } from "./renderer.js";

export function layoutTree(node, x, y) {
  const el = getRenderedEl(node.id);
  const h = el ? el.offsetHeight : CONFIG.FALLBACK_HEIGHT;
  node.x = x;

  const children = state.nodes.filter((n) => n.parent === node.id);

  if (children.length === 0) {
    node.y = y;
    return { minY: y, maxY: y + h };
  }

  let currentY = y;
  let totalMaxY = -Infinity;
  let firstChildH = CONFIG.FALLBACK_HEIGHT;

  children.forEach((child, idx) => {
    const childEl = getRenderedEl(child.id);
    const childW = childEl ? childEl.offsetWidth : CONFIG.FALLBACK_WIDTH;
    if (idx === 0) {
      firstChildH = childEl ? childEl.offsetHeight : CONFIG.FALLBACK_HEIGHT;
    }
    const childBounds = layoutTree(child, x - CONFIG.GAP - childW, currentY);
    currentY = childBounds.maxY + CONFIG.VERTICAL_GAP;
    totalMaxY = Math.max(totalMaxY, childBounds.maxY);
  });

  node.y = y + firstChildH / 2 - h / 2;

  return { minY: Math.min(node.y, y), maxY: Math.max(node.y + h, totalMaxY) };
}
