/**
 * @module move
 * @description "Move to page": transplants a node with its whole primary
 * subtree onto another page. The moved root is grafted (its outside
 * primary parent is cleared); every other outside input of a moved node
 * is resolved per user choice — move the dependency along too, or detach
 * it so the node stays independent. Outside nodes holding extra inputs
 * from moved nodes are left untouched (their threads hide while the
 * pages differ and reappear if reunited).
 */
import { state } from "./state.js";
import { dom, hideAllMenus, positionFloating } from "./dom.js";
import { nodeParentIds } from "./utils.js";
import { saveNode, removeParentInput } from "./db.js";
import { history } from "./history.js";
import { autoArrange } from "./arrange.js";
import { setActivePage, createPage, DEFAULT_CONFIRM_TEXT } from "./pages.js";
import { errorReporter } from "./error.js";

/** Id of the node chosen for moving (set when the move menu opens). */
let movingNodeId = null;

/**
 * Collects a node with its whole primary-children subtree.
 *
 * @param {object} root Subtree root.
 * @returns {Array<object>} Root first, then descendants.
 */
function collectSubtree(root) {
  const out = [root];
  const seen = new Set([String(root.id)]);
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift();
    state.nodes.forEach((n) => {
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
}

/**
 * Yes/no question via the shared confirm dialog. The generic
 * confirm-yes/no wiring stays a harmless no-op here (no pending delete
 * action and the notes target is parked aside for the duration).
 *
 * @param {string} question Question text.
 * @returns {Promise<boolean>} True for "yes".
 */
function askConfirm(question) {
  return new Promise((resolve) => {
    const yes = document.getElementById("confirm-yes");
    const no = document.getElementById("confirm-no");
    const text = document.getElementById("confirm-text");
    const savedNoteId = state.currentNoteNodeId;
    state.currentNoteNodeId = null;
    if (text) text.textContent = question;
    dom.confirmModal?.classList.remove("hidden");
    const done = (val) => {
      yes?.removeEventListener("click", onYes);
      no?.removeEventListener("click", onNo);
      dom.confirmModal?.classList.add("hidden");
      if (text) text.textContent = DEFAULT_CONFIRM_TEXT;
      state.currentNoteNodeId = savedNoteId;
      resolve(val);
    };
    const onYes = (e) => {
      e.stopPropagation();
      done(true);
    };
    const onNo = (e) => {
      e.stopPropagation();
      done(false);
    };
    yes?.addEventListener("click", onYes);
    no?.addEventListener("click", onNo);
  });
}

/**
 * Moves a node with its subtree onto another page, resolving outside
 * inputs interactively.
 *
 * @param {object} root Subtree root (mutated in place).
 * @param {string} targetId Target page id.
 * @returns {Promise<void>}
 */
export async function moveNodeToPage(root, targetId) {
  try {
    const target = state.pages.find((b) => String(b.id) === String(targetId));
    if (!root || !target || String(root.pageId) === String(targetId)) return;

    // The moved root is grafted: its outside primary parent is cleared.
    if (root.parent != null) root.parent = null;

    const moved = new Map();
    const queue = [];
    const enqueue = (node) => {
      const key = String(node.id);
      if (moved.has(key)) return;
      if (node.parent != null && !moved.has(String(node.parent))) {
        node.parent = null;
      }
      moved.set(key, node);
      queue.push(node);
    };
    collectSubtree(root).forEach(enqueue);

    while (queue.length) {
      const node = queue.shift();
      const outside = nodeParentIds(node).filter(
        (pid) => !moved.has(String(pid)),
      );
      for (const pid of outside) {
        const dep = state.nodes.find((n) => String(n.id) === String(pid));
        const depName = dep ? `«${dep.title}»` : "موردی";
        const moveAlong = await askConfirm(
          `«${node.title}» به ${depName} وابستگی دارد که در موارد انتخابی نیست — منتقل شود؟ (خیر = مستقل می‌ماند)`,
        );
        if (moveAlong && dep) {
          collectSubtree(dep).forEach(enqueue);
        } else {
          removeParentInput(node, pid);
        }
      }
    }

    moved.forEach((node) => {
      node.pageId = targetId;
      saveNode(node);
    });
    history.push(state.nodes, `انتقال «${root.title}» به صفحه «${target.title}»`);
    setActivePage(targetId);
    autoArrange();
  } catch (error) {
    errorReporter.report(error, { context: "moveNodeToPage" });
  }
}

/**
 * Visible page items of the move menu, in order.
 * @returns {Array<HTMLElement>}
 */
function moveListItems() {
  if (!dom.movePageList) return [];
  return [...dom.movePageList.querySelectorAll(".menu-item")];
}

/**
 * Moves keyboard focus to a move-menu item (roving tabindex).
 *
 * @param {HTMLElement|null} item Item to focus.
 * @returns {void}
 */
function focusMoveItem(item) {
  if (!item) return;
  moveListItems().forEach((i) => {
    i.tabIndex = -1;
  });
  item.tabIndex = 0;
  item.focus();
}

/**
 * Rebuilds the move menu's page list (other pages in tab-bar order),
 * filtered by title substring.
 *
 * @param {object} node Node to move.
 * @param {string} query Raw filter text.
 * @returns {void}
 */
function renderMoveList(node, query) {
  const q = (query ?? "").trim().toLowerCase();
  dom.movePageList.innerHTML = "";
  const shown = state.pages.filter(
    (b) =>
      String(b.id) !== String(node.pageId) &&
      b.title.toLowerCase().includes(q),
  );
  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "move-page-empty";
    empty.textContent = "صفحه‌ای یافت نشد";
    dom.movePageList.appendChild(empty);
    return;
  }
  shown.forEach((page) => {
    const item = document.createElement("div");
    item.className = "menu-item";
    item.setAttribute("role", "menuitem");
    item.tabIndex = -1;
    item.textContent = page.title;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      dom.moveMenu.classList.add("hidden");
      moveNodeToPage(node, page.id);
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        item.click();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = moveListItems();
        const i = items.indexOf(item);
        const next =
          e.key === "ArrowDown" ? items[i + 1] : (items[i - 1] ?? "search");
        if (next === "search") document.getElementById("move-search")?.focus();
        else focusMoveItem(next ?? null);
      }
    });
    dom.movePageList.appendChild(item);
  });
}

/**
 * Switches the move menu between options mode (icon row) and search
 * mode (back arrow + field).
 *
 * @param {boolean} searching True for search mode.
 * @returns {void}
 */
function setMoveSearchMode(searching) {
  dom.moveMenu
    ?.querySelector(".move-menu-top")
    ?.classList.toggle("hidden", searching);
  dom.moveMenu
    ?.querySelector(".move-search-row")
    ?.classList.toggle("hidden", !searching);
  const search = document.getElementById("move-search");
  if (search) {
    if (searching) {
      search.value = "";
      search.focus();
    }
    const node =
      movingNodeId != null
        ? state.nodes.find((n) => String(n.id) === String(movingNodeId))
        : null;
    if (node) renderMoveList(node, searching ? search.value : "");
  }
}

/**
 * Opens the move menu at (`x`, `y`): icon row (back, new page, search
 * toggle) and the other pages in tab-bar order.
 *
 * @param {number} x Viewport X anchor.
 * @param {number} y Viewport Y anchor.
 * @param {object} node Node to move.
 * @returns {void}
 */
export function showMoveMenu(x, y, node) {
  if (!node || !dom.moveMenu || !dom.movePageList) return;
  movingNodeId = node.id;
  hideAllMenus();
  setMoveSearchMode(false);
  positionFloating(dom.moveMenu, x, y);
}

/**
 * Wires the move menu's icon row (back, new page, search toggle) and
 * the live search field. Call once during bootstrapping.
 * @returns {void}
 */
export function setupMoveMenu() {
  const wireItem = (action, handler) => {
    const item = dom.moveMenu?.querySelector(`[data-action="${action}"]`);
    item?.addEventListener("click", (e) => {
      e.stopPropagation();
      handler();
    });
    item?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        item.click();
      }
    });
  };
  wireItem("move-back", () => {
    const x = parseInt(dom.moveMenu.style.left);
    const y = parseInt(dom.moveMenu.style.top);
    dom.moveMenu.classList.add("hidden");
    if (state.activeEl) positionFloating(dom.elementMenu, x, y);
  });
  wireItem("new-page", async () => {
    if (movingNodeId == null) return;
    const node = state.nodes.find((n) => String(n.id) === String(movingNodeId));
    if (!node) return;
    dom.moveMenu.classList.add("hidden");
    const page = await createPage();
    moveNodeToPage(node, page.id);
  });
  wireItem("move-search-toggle", () => {
    setMoveSearchMode(true);
  });
  wireItem("move-search-back", () => {
    setMoveSearchMode(false);
  });
  document.getElementById("move-search")?.addEventListener("input", (e) => {
    const node =
      movingNodeId != null
        ? state.nodes.find((n) => String(n.id) === String(movingNodeId))
        : null;
    if (node) renderMoveList(node, e.target.value);
  });
  document.getElementById("move-search")?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusMoveItem(moveListItems()[0] ?? null);
    }
  });
}
