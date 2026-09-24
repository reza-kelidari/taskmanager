/**
 * @module arrange
 * @description Automatic layout: primary-parent forest layout, the
 * shortcut-pattern post-pass (A > B > C together with A > C), viewport
 * auto-panning, and coordinate sanitizing.
 */
import { state } from "./state.js";
import { dom } from "./dom.js";
import { CONFIG } from "./config.js";
import { finite, isNodeHidden, nodeParentIds, showToast } from "./utils.js";
import { errorReporter } from "./error.js";
import { saveNode } from "./db.js";
import { history } from "./history.js";
import { renderNodes, getRenderedEl } from "./renderer.js";
import { layoutTree } from "./layout.js";
import { drawConnections } from "./connections.js";

/**
 * One vertical level; falls back to a safe default on legacy configs.
 * @returns {number}
 */
const levelStep = () => (finite(CONFIG.LEVEL_STEP) ? CONFIG.LEVEL_STEP : 65);

/**
 * Measured rendered height of a node with a safe fallback.
 * @param {object} node
 * @returns {number}
 */
function nodeHeight(n) {
  const el = getRenderedEl(n.id);
  const h = el ? el.offsetHeight : CONFIG.FALLBACK_HEIGHT;
  return finite(h) ? h : CONFIG.FALLBACK_HEIGHT;
}

/**
 * Sanitizes node coordinates in place and persists the fixes:
 * - Non-finite values get safe fallbacks. Browsers silently ignore
 *   invalid CSS like `top: NaNpx`, freezing the node in place.
 * - Fractional values are snapped to whole pixels; fractional offsets
 *   round inconsistently and cause 1–2px visual drift.
 *
 * @param {Array<object>} nodesList Nodes to sanitize.
 * @returns {void}
 */
export function scrubPositions(nodesList) {
  nodesList.forEach((node, i) => {
    let fixed = false;
    if (!finite(node.x)) {
      node.x = 300;
      fixed = true;
    }
    if (!finite(node.y)) {
      node.y =
        CONFIG.CANVAS_INITIAL_Y_OFFSET +
        i * (CONFIG.VERTICAL_GAP + CONFIG.FALLBACK_HEIGHT);
      fixed = true;
    }
    const rx = Math.round(node.x);
    const ry = Math.round(node.y);
    if (rx !== node.x || ry !== node.y) {
      node.x = rx;
      node.y = ry;
      fixed = true;
    }
    if (fixed) saveNode(node);
  });
}

/**
 * Applies the automatic layout to all (non-filtered) nodes.
 *
 * The layout always runs on the primary-parent forest. When the done-task
 * filter is active, completed tasks and fully-done non-root headers (see
 * {@link isHeaderAutoHidden}) are excluded, and nodes whose primary
 * parent is filtered out are temporarily re-attached to their nearest
 * visible ancestor so the forest stays connected; the original parents are
 * restored in a `finally` block, so persisted data is never rewritten by
 * the filter. After the base layout the shortcut pattern receives special
 * alignment (see {@link applyShortcutAlignment}), coordinates are snapped
 * to pixels, and the result is animated from the old positions.
 *
 * @returns {void}
 */
export function autoArrange() {
  const allNodes = state.nodes;
  const filterOn = document.body.classList.contains("filter-active");

  const layoutNodes = filterOn
    ? allNodes.filter((n) => !isNodeHidden(n))
    : allNodes;

  if (layoutNodes.length === 0) return;

  scrubPositions(layoutNodes);

  const layoutIds = new Set(layoutNodes.map((n) => String(n.id)));

  const savedParents = new Map();
  if (filterOn) {
    layoutNodes.forEach((n) => {
      if (!n.parent || layoutIds.has(String(n.parent))) return;
      let ancId = n.parent;
      let visibleAnc = null;
      const guard = new Set();
      while (ancId && !guard.has(String(ancId))) {
        guard.add(String(ancId));
        if (layoutIds.has(String(ancId))) {
          visibleAnc = ancId;
          break;
        }
        const ancNode = allNodes.find((m) => String(m.id) === String(ancId));
        ancId = ancNode?.parent ?? null;
      }
      savedParents.set(String(n.id), n.parent);
      n.parent = visibleAnc;
    });
  }

  state.nodes = layoutNodes;
  try {
    renderNodes();

    const oldPos = {};
    layoutNodes.forEach((n) => (oldPos[n.id] = { x: n.x, y: n.y }));

    const roots = layoutNodes.filter((n) => !n.parent);
    if (roots.length === 0) return;

    let currentY = CONFIG.CANVAS_INITIAL_Y_OFFSET;
    roots.forEach((root) => {
      const bounds = layoutTree(root, 300, currentY);
      currentY = Math.round(bounds.maxY + 25.7);
    });

    layoutNodes.forEach((n) => {
      if (finite(n.x)) n.x = Math.round(n.x);
      if (finite(n.y)) n.y = Math.round(n.y);
    });

    applyShortcutAlignment(layoutNodes);

    const { minX, minY, maxX, maxY } = computeBounds();
    const canvasPanned = maybeAutoPan(minX, minY, maxX, maxY);

    layoutNodes.forEach((node) => {
      const el = getRenderedEl(node.id);
      if (el) {
        el.style.left = `${oldPos[node.id].x}px`;
        el.style.top = `${oldPos[node.id].y}px`;
      }
    });

    void dom.canvas.offsetWidth;

    layoutNodes.forEach((node) => {
      const el = getRenderedEl(node.id);
      if (el) {
        el.classList.add("smooth-arrange");
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
      }
    });

    const start = performance.now();
    const animateLoop = (now) => {
      drawConnections();
      if (now - start < CONFIG.ANIMATION_DURATION) {
        requestAnimationFrame(animateLoop);
      } else {
        layoutNodes.forEach((node) => {
          const el = getRenderedEl(node.id);
          if (el) el.classList.remove("smooth-arrange");
        });
        if (canvasPanned) dom.canvas.style.transition = "";
      }
    };
    requestAnimationFrame(animateLoop);
  } catch (error) {
    errorReporter.report(error, { context: "autoArrange" });
    console.error("[autoArrange]", error);
    showToast("خطا در چینش خودکار — جزئیات در کنسول", "error");
  } finally {
    state.nodes = allNodes;
    savedParents.forEach((parent, id) => {
      const node = allNodes.find((n) => String(n.id) === id);
      if (node) node.parent = parent;
    });
  }

  allNodes.forEach(saveNode);
  history.push(allNodes, "چینش خودکار");
}

/**
 * Shortcut-pattern alignment (A > B > C together with a direct A > C):
 *
 * ```
 *   A ══[gap]══[gap]══[B column]══ C      ← A and C share one center axis
 *    ╲                                   │
 *     ╲ curve A→B                        │ thread B→C
 *      ╲                                 │
 *       B ◄──────────────────────────────┘  ← one level below the axis
 * ```
 *
 * Geometry:
 * - `gap` is the free horizontal space measured edge-to-edge between A's
 *   left edge and B's right edge (taken from the real rendered layout).
 * - C is placed so its right edge sits exactly one `gap` ahead of B's
 *   left edge, making the total A→C distance `2×gap + width(B)`; the
 *   B→C thread then gets the horizontal run of a normal one-level edge.
 * - Alignment is center-to-center (matching layoutTree's centering), so
 *   mixed node heights stay on the axis. B is centered one level below.
 *
 * Detection is connection-order independent: since a node's first input
 * becomes its primary parent and later ones go to `extraParents`, the
 * same graph has two data shapes (`C.parent = B` or `C.parent = A`); it
 * suffices that C holds inputs from *both* A and B and its primary parent
 * is one of them.
 *
 * Every translation moves the whole subtree (via primary-parent links),
 * and the pass is fully defensive: corrupt data is skipped and any error
 * is contained so the base layout survives.
 *
 * @param {Array<object>} nodesList Visible nodes after the base layout.
 * @returns {void}
 */
function applyShortcutAlignment(nodesList) {
  try {
    const byId = new Map(nodesList.map((n) => [String(n.id), n]));
    const handled = new Set();
    const step = levelStep();

    /**
     * Subtree of `root` including itself, via primary-parent links only
     * (tree, not DAG).
     *
     * @param {object} root
     * @returns {Array<object>}
     */
    const subtreeOf = (root) => {
      const out = [root];
      const seen = new Set([String(root.id)]);
      const queue = [root];
      while (queue.length) {
        const cur = queue.shift();
        nodesList.forEach((n) => {
          if (
            n.parent != null &&
            String(n.parent) === String(cur.id) &&
            !seen.has(String(n.id))
          ) {
            seen.add(String(n.id));
            out.push(n);
            queue.push(n);
          }
        });
      }
      return out;
    };

    nodesList.forEach((b) => {
      if (!b.parent) return;
      const a = byId.get(String(b.parent));
      if (!a) return;

      if (!finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y)) return;

      const elB = getRenderedEl(b.id);
      const bW = elB ? elB.offsetWidth : CONFIG.FALLBACK_WIDTH;
      if (!finite(bW)) return;

      const aH = nodeHeight(a);
      const bH = nodeHeight(b);

      const measuredGap = a.x - (b.x + bW);
      const gap =
        finite(measuredGap) && measuredGap > 0 ? measuredGap : CONFIG.GAP;

      const shortcuts = nodesList.filter((n) => {
        if (String(n.id) === String(a.id)) return false;
        if (String(n.id) === String(b.id)) return false;
        if (handled.has(String(n.id))) return false;
        if (!finite(n.x) || !finite(n.y)) return false;
        const inputs = nodeParentIds(n).map(String);
        if (!inputs.includes(String(a.id))) return false;
        if (!inputs.includes(String(b.id))) return false;
        const primary = n.parent != null ? String(n.parent) : null;
        return primary === String(a.id) || primary === String(b.id);
      });
      if (shortcuts.length === 0) return;

      shortcuts.forEach((c) => handled.add(String(c.id)));

      const shortcutSubtree = new Set();
      shortcuts.forEach((c) => {
        subtreeOf(c).forEach((n) => shortcutSubtree.add(n));
      });

      const bTargetY = Math.round(
        a.y + aH / 2 - bH / 2 + shortcuts.length * step,
      );
      const dy = bTargetY - b.y;
      if (dy !== 0 && finite(dy)) {
        subtreeOf(b).forEach((n) => {
          if (!shortcutSubtree.has(n)) n.y += dy;
        });
      }

      shortcuts.forEach((c, i) => {
        const elC = getRenderedEl(c.id);
        const cW = elC ? elC.offsetWidth : CONFIG.FALLBACK_WIDTH;
        if (!finite(cW)) return;
        const cH = nodeHeight(c);

        const targetX = Math.round(b.x - gap - cW);
        const targetY = Math.round(a.y + aH / 2 - cH / 2 + i * step);
        if (!finite(targetX) || !finite(targetY)) return;
        const dx = targetX - c.x;
        const dyC = targetY - c.y;
        if (!finite(dx) || !finite(dyC)) return;
        if (dx !== 0 || dyC !== 0) {
          subtreeOf(c).forEach((n) => {
            n.x += dx;
            n.y += dyC;
          });
        }
      });
    });
  } catch (err) {
    errorReporter.report(err, { context: "applyShortcutAlignment" });
    console.error("[shortcut-align]", err);
  }
}

/**
 * Computes the bounding box of all visible nodes (rendered sizes when
 * available, fallbacks otherwise). Nodes with corrupt coordinates are
 * skipped.
 *
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
function computeBounds() {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  state.nodes.forEach((node) => {
    if (!finite(node.x) || !finite(node.y)) return;
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

/**
 * Pans the canvas so the content bounds re-enter the viewport when the
 * layout ended up fully off-screen.
 *
 * @param {number} minX
 * @param {number} minY
 * @param {number} maxX
 * @param {number} maxY
 * @returns {boolean} True when a pan was performed.
 */
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

/**
 * Moves the canvas origin to (`x`, `y`), optionally animated, and
 * persists the offset.
 *
 * @param {number} x New canvas left (viewport space).
 * @param {number} y New canvas top (viewport space).
 * @param {boolean} [withTransition=true] Animate the move.
 * @returns {void}
 */
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
