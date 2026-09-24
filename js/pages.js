/**
 * @module pages
 * @description Independent pages (tabs): boot/migration, switching,
 * creation, inline renaming and the bottom tab bar. Each node carries a
 * `pageId`; rendering, layout, connections and hit-testing always show
 * the active page only, while history snapshots keep spanning the whole
 * graph so undo/redo stay consistent across switches.
 */
import { state } from "./state.js";
import { dom, hideAllMenus, hideAllModals, positionFloating } from "./dom.js";
import { isActivePageNode } from "./utils.js";
import {
  savePage,
  loadPages,
  deletePageDB,
  saveNode,
  deleteNodeDB,
} from "./db.js";
import { history } from "./history.js";
import { renderNodes } from "./renderer.js";
import { drawConnections } from "./connections.js";
import { errorReporter } from "./error.js";

const ACTIVE_PAGE_KEY = "activePageId";
/** Legacy localStorage key from the brief `boards` naming. */
const LEGACY_ACTIVE_KEY = "activeBoardId";

/**
 * Default confirm-dialog question (note deletion); page deletion swaps
 * in its own question and restores this afterwards.
 */
export const DEFAULT_CONFIRM_TEXT = "آیا از حذف این یادداشت اطمینان دارید؟";

/** Id of the page targeted by the tab right-click menu. */
let menuPageId = null;

const CHECK_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

/**
 * Generates a page id (UUID with a Math.random fallback).
 * @returns {string}
 */
function genPageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Persian-digit page title (`صفحه ۱`, `صفحه ۲`, ...), unique among pages.
 * @returns {string}
 */
function nextPageTitle() {
  const fa = (n) =>
    String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  const taken = new Set(state.pages.map((b) => b.title));
  let n = state.pages.length + 1;
  while (taken.has(`صفحه ${fa(n)}`)) n += 1;
  return `صفحه ${fa(n)}`;
}

/**
 * Boots pages: loads stored pages (creating the first one when none
 * exist), migrates page-less nodes onto the first page, and restores
 * the active page. Call once after nodes are loaded, before rendering.
 * @returns {Promise<void>}
 */
export async function ensurePages() {
  try {
    const stored = await loadPages();
    state.pages = (Array.isArray(stored) ? stored : []).filter(
      (b) => b && b.id,
    );
    if (state.pages.length === 0) {
      const first = {
        id: genPageId(),
        title: nextPageTitle(),
        createdAt: Date.now(),
      };
      state.pages.push(first);
      await savePage(first);
    }
    const byId = new Map(state.pages.map((b) => [String(b.id), b]));
    const firstId = state.pages[0].id;
    state.nodes.forEach((node) => {
      let dirty = false;
      if (node.pageId == null && node.boardId != null) {
        node.pageId = node.boardId;
        dirty = true;
      }
      if ("boardId" in node) {
        delete node.boardId;
        dirty = true;
      }
      if (node.pageId == null || !byId.has(String(node.pageId))) {
        node.pageId = firstId;
        dirty = true;
      }
      if (dirty) saveNode(node);
    });
    let active = null;
    try {
      active =
        localStorage.getItem(ACTIVE_PAGE_KEY) ??
        localStorage.getItem(LEGACY_ACTIVE_KEY);
    } catch (_) {
      /* storage unavailable */
    }
    state.activePageId =
      active && byId.has(String(active)) ? active : firstId;
    try {
      localStorage.setItem(ACTIVE_PAGE_KEY, state.activePageId);
    } catch (_) {
      /* storage unavailable */
    }
    renderPageTabs();
  } catch (error) {
    errorReporter.report(error, { context: "ensurePages" });
  }
}

/**
 * Refreshes the empty-state hint for the active page.
 * @returns {void}
 */
export function updateEmptyState() {
  if (!dom.emptyState) return;
  dom.emptyState.style.display = state.nodes.some(isActivePageNode)
    ? "none"
    : "block";
}

/**
 * Switches to a page: persists the choice, closes menus/modals,
 * re-renders the canvas and refreshes tabs and the empty state.
 *
 * @param {string} id Page id.
 * @returns {void}
 */
export function setActivePage(id) {
  if (id == null) return;
  state.activePageId = id;
  try {
    localStorage.setItem(ACTIVE_PAGE_KEY, id);
  } catch (_) {
    /* storage unavailable */
  }
  hideAllMenus();
  hideAllModals();
  state.detailsNodeId = null;
  if (dom.hoverBox) dom.hoverBox.classList.add("hidden");
  renderPageTabs();
  renderNodes();
  drawConnections();
  updateEmptyState();
}

/**
 * Creates a page and switches into it. Page creation touches no nodes,
 * so no history entry is recorded.
 *
 * @returns {Promise<object>} The new page.
 */
export async function createPage() {
  const page = {
    id: genPageId(),
    title: nextPageTitle(),
    createdAt: Date.now(),
  };
  state.pages.push(page);
  try {
    await savePage(page);
  } catch (error) {
    errorReporter.report(error, { context: "createPage" });
  }
  setActivePage(page.id);
  return page;
}

/**
 * Persists a page with a timeout race: the UI must never hang waiting
 * for storage — a slow write resolves best-effort in the background.
 *
 * @param {object} page Page record.
 * @returns {Promise<void>}
 */
async function persistPage(page) {
  try {
    await Promise.race([
      savePage(page),
      new Promise((res) => setTimeout(() => res(false), 2000)),
    ]);
  } catch (error) {
    errorReporter.report(error, { context: "persistPage" });
  }
}

/** Id of the page being dragged for reorder; null when idle. */
let dragPageId = null;
/** Drop target: `{id, after}` or `{append:true}`; null when none. */
let dropTarget = null;

/**
 * Renames a page and persists it. Empty titles are rejected (false).
 * Never touches the DOM — callers rebuild the tabs afterwards.
 *
 * @param {string} id Page id.
 * @param {string} title New title.
 * @returns {Promise<boolean>} True when renamed (or already identical).
 */
export async function renamePage(id, title) {
  const page = state.pages.find((b) => String(b.id) === String(id));
  const clean = (title ?? "").trim();
  if (!page || clean.length === 0) return false;
  if (page.title === clean) return true;
  page.title = clean;
  await persistPage(page);
  return true;
}

/**
 * Deletes a page with all its nodes. Empty pages are deleted
 * immediately; non-empty ones ask for confirmation first. Refused when
 * it is the only page left.
 *
 * @param {string} id Page id.
 * @returns {void}
 */
export function deletePage(id) {
  const page = state.pages.find((b) => String(b.id) === String(id));
  if (!page || state.pages.length <= 1) return;
  hideAllMenus();
  const doDelete = () => {
    const ids = new Set(
      state.nodes
        .filter((n) => String(n.pageId) === String(id))
        .map((n) => n.id),
    );
    ids.forEach((nodeId) => deleteNodeDB(nodeId));
    state.nodes = state.nodes.filter((n) => !ids.has(n.id));
    state.pages = state.pages.filter((b) => String(b.id) !== String(id));
    deletePageDB(id);
    if (String(state.activePageId) === String(id)) {
      state.activePageId = state.pages[0].id;
    }
    history.push(state.nodes, `حذف صفحه «${page.title}»`);
  };
  const hasNodes = state.nodes.some(
    (n) => String(n.pageId) === String(id),
  );
  if (!hasNodes) {
    doDelete();
    setActivePage(state.activePageId);
    return;
  }
  state.pendingDeleteAction = () => {
    doDelete();
    document.getElementById("confirm-text").textContent =
      DEFAULT_CONFIRM_TEXT;
    dom.confirmModal.classList.add("hidden");
    state.pendingDeleteAction = null;
    setActivePage(state.activePageId);
  };
  document.getElementById("confirm-text").textContent =
    `آیا از حذف صفحه «${page.title}» و همه وظایفش اطمینان دارید؟`;
  dom.confirmModal?.classList.remove("hidden");
}

/**
 * Shows the tab right-click menu at the pointer position. The delete
 * item is disabled while only one page exists.
 *
 * @param {string} id Page id.
 * @param {number} x Viewport X coordinate.
 * @param {number} y Viewport Y coordinate.
 * @returns {void}
 */
function showPageMenu(id, x, y) {
  if (!dom.pageMenu) return;
  menuPageId = id;
  const del = dom.pageMenu.querySelector('[data-action="delete-page"]');
  const single = state.pages.length <= 1;
  del.classList.toggle("disabled", single);
  del.setAttribute("aria-disabled", String(single));
  hideAllMenus();
  positionFloating(dom.pageMenu, x, y);
}

/**
 * Starts inline renaming of a page tab: swaps the title for an input
 * plus a check button (click/Enter/blur commits, Escape cancels).
 *
 * @param {HTMLElement} tabEl Tab element.
 * @param {object} page Page record.
 * @returns {void}
 */
function startPageRename(tabEl, page) {
  const label = tabEl.querySelector(".tab-title");
  if (!label || tabEl.querySelector(".tab-rename-input")) return;
  label.style.display = "none";
  tabEl.classList.add("editing");
  const input = document.createElement("input");
  input.className = "tab-rename-input";
  input.value = page.title;
  input.maxLength = 25;
  input.setAttribute("aria-label", "ویرایش عنوان صفحه");
  const save = document.createElement("button");
  save.className = "tab-rename-save";
  save.title = "تایید";
  save.setAttribute("aria-label", "تایید");
  save.innerHTML = CHECK_SVG;
  tabEl.appendChild(input);
  tabEl.appendChild(save);
  input.focus();
  input.select();
  let done = false;
  // Every exit path rebuilds the tabs so the editor always closes,
  // even when the title is unchanged or empty (reverts).
  const commit = async (saveIt) => {
    if (done) return;
    done = true;
    if (saveIt) await renamePage(page.id, input.value);
    renderPageTabs();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  // Save deterministically on pointerdown/mousedown (focus is kept, so
  // no blur fires and the button cannot disappear before mouseup): the
  // later click is a guarded no-op and the tab never sees the press.
  const doSave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    commit(true);
  };
  save.addEventListener("pointerdown", doSave);
  save.addEventListener("mousedown", doSave);
  save.addEventListener("click", (e) => {
    e.stopPropagation();
    commit(true);
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      commit(false);
    }
  });
  input.addEventListener("blur", () => commit(true));
}

/**
 * Rebuilds the tab bar from `state.pages`. Clicking an inactive tab
 * switches to it; clicking the active tab's title renames it.
 * @returns {void}
 */
export function renderPageTabs() {
  const list = document.getElementById("tabs-list");
  if (!list) return;
  list.innerHTML = "";
  state.pages.forEach((page) => {
    const tab = document.createElement("div");
    tab.className = "tab";
    tab.dataset.id = page.id;
    tab.setAttribute("role", "tab");
    const active = String(page.id) === String(state.activePageId);
    tab.setAttribute("aria-selected", String(active));
    if (active) tab.classList.add("active");
    const label = document.createElement("span");
    label.className = "tab-title";
    label.textContent = page.title;
    tab.appendChild(label);
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      if (String(page.id) === String(state.activePageId)) {
        startPageRename(tab, page);
      } else {
        setActivePage(page.id);
      }
    });
    list.appendChild(tab);
  });
}

/**
 * Wires the "+" (new page) button, the tab right-click menu and its
 * delete item. Call once during bootstrapping.
 * @returns {void}
 */
export function setupPages() {
  document
    .getElementById("tab-add")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      createPage();
    });
  document.getElementById("tabs-list")?.addEventListener("contextmenu", (e) => {
    const tab = e.target.closest?.(".tab");
    if (!tab) return;
    e.preventDefault();
    e.stopPropagation();
    showPageMenu(tab.dataset.id, e.clientX, e.clientY);
  });
  dom.pageMenu
    ?.querySelector('[data-action="delete-page"]')
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.currentTarget.classList.contains("disabled")) return;
      dom.pageMenu.classList.add("hidden");
      if (menuPageId != null) deletePage(menuPageId);
    });
  renderPageTabs();
}
