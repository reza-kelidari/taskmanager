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
/** Whether the card title is being renamed (blocks card refreshes). */
let cardRenaming = false;
/** Whether the card description is being edited (blocks refreshes). */
let descEditing = false;
/** Id of the page being dragged for reorder; null when idle. */
let dragPageId = null;
/** Tab element being dragged (removed from the list once underway). */
let dragTabEl = null;
/** Drop target: `{id, after}` or `{append:true}`; null when none. */
let dropTarget = null;
/** Standalone straight drop marker between tabs. */
let markerEl = null;

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
    state.pages.sort(
      (a, b) =>
        (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0),
    );
    state.pages.forEach((p, i) => {
      let dirty = false;
      if (p.order !== i) {
        p.order = i;
        dirty = true;
      }
      if (p.desc == null) {
        p.desc = "";
        dirty = true;
      }
      if (dirty) savePage(p);
    });
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
    const cx = parseInt(dom.canvas.style.left);
    const cy = parseInt(dom.canvas.style.top);
    state.pages.forEach((p) => {
      if (!Number.isFinite(p.viewX) || !Number.isFinite(p.viewY)) {
        p.viewX = Number.isFinite(cx) ? cx : Math.round(window.innerWidth / 2);
        p.viewY = Number.isFinite(cy) ? cy : Math.round(window.innerHeight / 2);
        savePage(p);
      }
    });
    renderPageTabs();
    restoreActiveView();
    updatePageCard();
    scrollActiveTabIntoView();
  } catch (error) {
    errorReporter.report(error, { context: "ensurePages" });
  }
}

/**
 * Refreshes the page info card: the active page title plus its
 * description (placeholder when empty) for the hover reveal.
 * Skipped while the card title or description is being edited.
 * @returns {void}
 */
export function updatePageCard() {
  if (cardRenaming || descEditing) return;
  const titleEl = document.getElementById("page-card-title");
  const descEl = document.getElementById("page-desc");
  const page = state.pages.find(
    (b) => String(b.id) === String(state.activePageId),
  );
  if (titleEl) titleEl.textContent = page ? page.title : "";
  if (!descEl) return;
  const desc = (page?.desc ?? "").trim();
  descEl.textContent = desc.length === 0 ? "برای افزودن توضیحات کلیک کنید" : desc;
  descEl.classList.toggle("empty", desc.length === 0);
}

/**
 * Starts inline editing of the page description: swaps it for a
 * textarea plus a check+text save button. Clicking anywhere else
 * cancels; only the save button saves.
 * @returns {void}
 */
function startDescEdit() {
  const descEl = document.getElementById("page-desc");
  const page = state.pages.find(
    (b) => String(b.id) === String(state.activePageId),
  );
  if (!descEl || !page || descEl.querySelector(".page-desc-input")) return;
  descEditing = true;
  descEl.classList.remove("empty");
  descEl.innerHTML = "";
  const area = document.createElement("textarea");
  area.className = "page-desc-input";
  area.value = page.desc ?? "";
  area.rows = 3;
  area.setAttribute("aria-label", "ویرایش توضیحات صفحه");
  const row = document.createElement("div");
  row.className = "page-desc-row";
  const save = document.createElement("button");
  save.className = "save-text-btn";
  save.title = "ذخیره";
  save.setAttribute("aria-label", "ذخیره");
  save.innerHTML = `${CHECK_SVG}<span>ذخیره</span>`;
  row.appendChild(save);
  descEl.appendChild(area);
  descEl.appendChild(row);
  area.focus();
  let done = false;
  const commit = async (saveIt) => {
    if (done) return;
    done = true;
    if (saveIt) {
      page.desc = area.value.trim();
      await persistPage(page);
    }
    descEditing = false;
    updatePageCard();
  };
  area.addEventListener("click", (e) => e.stopPropagation());
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
  area.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      commit(false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit(true);
    }
  });
  area.addEventListener("blur", () => commit(false));
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
 * Scrolls the tab bar so the active tab is visible (used after boot
 * restore and programmatic switches).
 * @returns {void}
 */
export function scrollActiveTabIntoView() {
  document
    .getElementById("tabs-list")
    ?.querySelector(".tab.active")
    ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/**
 * Switches to a page: persists the choice, closes menus/modals,
 * restores the page's saved viewport, re-renders the canvas and
 * refreshes tabs and the empty state.
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
  restoreActiveView();
  renderPageTabs();
  scrollActiveTabIntoView();
  renderNodes();
  drawConnections();
  updateEmptyState();
  updatePageCard();
}

/**
 * Creates a page (starting at the viewport center) and switches into
 * it. Page creation touches no nodes, so no history entry is recorded.
 *
 * @returns {Promise<object>} The new page.
 */
export async function createPage() {
  const page = {
    id: genPageId(),
    title: nextPageTitle(),
    createdAt: Date.now(),
    order: state.pages.length,
    desc: "",
    viewX: Math.round(window.innerWidth / 2),
    viewY: Math.round(window.innerHeight / 2),
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

/**
 * Saves the canvas offset into the active page record (best-effort).
 *
 * @param {number|string} x Canvas left.
 * @param {number|string} y Canvas top.
 * @returns {void}
 */
export function saveActiveView(x, y) {
  const page = state.pages.find(
    (b) => String(b.id) === String(state.activePageId),
  );
  if (!page) return;
  const nx = parseInt(x);
  const ny = parseInt(y);
  if (isNaN(nx) || isNaN(ny)) return;
  page.viewX = nx;
  page.viewY = ny;
  persistPage(page);
}

/**
 * Restores the active page's saved canvas offset (instant, no
 * transition), falling back to the viewport center.
 * @returns {void}
 */
export function restoreActiveView() {
  const page = state.pages.find(
    (b) => String(b.id) === String(state.activePageId),
  );
  const x =
    page && Number.isFinite(page.viewX)
      ? page.viewX
      : Math.round(window.innerWidth / 2);
  const y =
    page && Number.isFinite(page.viewY)
      ? page.viewY
      : Math.round(window.innerHeight / 2);
  dom.canvas.style.transition = "";
  dom.canvas.style.left = `${x}px`;
  dom.canvas.style.top = `${y}px`;
}

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
 * Moves a dragged page to a drop target, persists the new order and
 * rebuilds the tabs.
 *
 * @param {string} dragId Dragged page id.
 * @param {{id?: string, after?: boolean, append?: boolean}} target Drop target.
 * @returns {void}
 */
function movePage(dragId, target) {
  const from = state.pages.findIndex((b) => String(b.id) === String(dragId));
  if (from < 0) return;
  const [moved] = state.pages.splice(from, 1);
  if (target.append || state.pages.length === 0) {
    state.pages.push(moved);
  } else {
    let idx = state.pages.findIndex((b) => String(b.id) === String(target.id));
    if (idx < 0) {
      state.pages.push(moved);
    } else {
      if (target.after) idx += 1;
      state.pages.splice(idx, 0, moved);
    }
  }
  state.pages.forEach((p, i) => {
    p.order = i;
    savePage(p);
  });
  renderPageTabs();
}

/**
 * Clears the drag-reorder state: removes the marker and restores the
 * dragged tab into the list.
 * @returns {void}
 */
function cleanupDrag() {
  dragPageId = null;
  dropTarget = null;
  if (markerEl) markerEl.classList.add("hidden");
  if (dragTabEl) {
    dragTabEl.style.display = "";
    dragTabEl.style.opacity = "";
    dragTabEl = null;
  }
}

/**
 * Lazily creates the standalone drop marker (a straight vertical line
 * positioned between tabs).
 * @returns {HTMLElement} Marker element.
 */
function ensureMarker() {
  if (!markerEl) {
    markerEl = document.createElement("div");
    markerEl.id = "tab-drop-marker";
    markerEl.className = "hidden";
    document.body.appendChild(markerEl);
  }
  return markerEl;
}

/**
 * Positions the drop marker as a vertical line at viewport X,
 * spanning the tab height.
 *
 * @param {number} x Viewport X of the line.
 * @param {number} top Viewport top.
 * @param {number} height Line height.
 * @returns {void}
 */
function positionMarker(x, top, height) {
  const m = ensureMarker();
  m.style.left = `${x - 1}px`;
  m.style.top = `${top}px`;
  m.style.height = `${height}px`;
  m.classList.remove("hidden");
}

/**
 * Starts inline renaming of the page card title: swaps it for an input
 * plus a check button (click/Enter/blur commits, Escape cancels).
 * @returns {void}
 */
function startCardRename() {
  const titleEl = document.getElementById("page-card-title");
  const page = state.pages.find(
    (b) => String(b.id) === String(state.activePageId),
  );
  if (!titleEl || !page || titleEl.querySelector(".card-rename-input"))
    return;
  cardRenaming = true;
  titleEl.innerHTML = "";
  const input = document.createElement("input");
  input.className = "card-rename-input";
  input.value = page.title;
  input.maxLength = 30;
  input.setAttribute("aria-label", "ویرایش عنوان صفحه");
  const save = document.createElement("button");
  save.className = "card-rename-save";
  save.title = "تایید";
  save.setAttribute("aria-label", "تایید");
  save.innerHTML = CHECK_SVG;
  titleEl.appendChild(input);
  titleEl.appendChild(save);
  input.focus();
  input.select();
  let done = false;
  // Every exit path refreshes the card so the editor always closes,
  // even when the title is unchanged or empty (reverts).
  const commit = async (saveIt) => {
    if (done) return;
    done = true;
    if (saveIt) await renamePage(page.id, input.value);
    cardRenaming = false;
    renderPageTabs();
    updatePageCard();
  };
  input.addEventListener("click", (e) => e.stopPropagation());
  // Save deterministically on pointerdown/mousedown (focus is kept, so
  // no blur fires and the button cannot disappear before mouseup): the
  // later click is a guarded no-op.
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
 * Rebuilds the tab bar from `state.pages`. Tabs are draggable for
 * reorder; clicking a tab switches to it. The list button appears only
 * past 4 pages.
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
    tab.draggable = true;
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
      setActivePage(page.id);
    });
    list.appendChild(tab);
  });
  document
    .getElementById("tab-list-btn")
    ?.classList.toggle("hidden", state.pages.length <= 4);
}

/**
 * Visible items of the pages modal, in order.
 * @returns {Array<HTMLElement>}
 */
function visibleModalItems() {
  if (!dom.pagesModalList) return [];
  return [...dom.pagesModalList.querySelectorAll(".pages-modal-item")];
}

/**
 * Moves keyboard focus to a modal item (roving tabindex).
 *
 * @param {HTMLElement|null} item Item to focus.
 * @returns {void}
 */
function focusModalItem(item) {
  if (!item) return;
  visibleModalItems().forEach((i) => {
    i.tabIndex = -1;
  });
  item.tabIndex = 0;
  item.focus();
}

/**
 * Opens the vertical pages list modal (tab-bar order, active marked),
 * with a live title filter and the search box ready for typing.
 * Keyboard navigation starts with ArrowDown from the search box.
 * @returns {void}
 */
export function openPagesModal() {
  if (!dom.pagesModal || !dom.pagesModalList) return;
  hideAllMenus();
  if (dom.pagesModalSearch) dom.pagesModalSearch.value = "";
  renderPagesModalList("");
  dom.pagesModal.classList.remove("hidden");
  dom.pagesModalSearch?.focus();
}

/**
 * Rebuilds the modal list, filtered by title substring.
 *
 * @param {string} query Raw filter text.
 * @returns {void}
 */
function renderPagesModalList(query) {
  const q = (query ?? "").trim().toLowerCase();
  dom.pagesModalList.innerHTML = "";
  const shown = state.pages.filter((page) =>
    page.title.toLowerCase().includes(q),
  );
  if (shown.length === 0) {
    const empty = document.createElement("div");
    empty.className = "pages-modal-empty";
    empty.textContent = "صفحه‌ای یافت نشد";
    dom.pagesModalList.appendChild(empty);
    return;
  }
  shown.forEach((page) => {
    const item = document.createElement("div");
    item.className = "pages-modal-item";
    item.setAttribute("role", "option");
    item.tabIndex = -1;
    item.dataset.id = page.id;
    item.textContent = page.title;
    if (String(page.id) === String(state.activePageId)) {
      item.classList.add("active");
    }
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      dom.pagesModal.classList.add("hidden");
      setActivePage(page.id);
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        item.click();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = visibleModalItems();
        const i = items.indexOf(item);
        const next =
          e.key === "ArrowDown" ? items[i + 1] : (items[i - 1] ?? "search");
        if (next === "search") dom.pagesModalSearch?.focus();
        else focusModalItem(next ?? null);
      }
    });
    dom.pagesModalList.appendChild(item);
  });
}

/**
 * Wires the "+" (new page) button, drag-reorder of tabs, the tab
 * right-click menu and its delete item. Call once during bootstrapping.
 * @returns {void}
 */
export function setupPages() {
  document
    .getElementById("tab-add")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      createPage();
    });
  document
    .getElementById("tab-list-btn")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      openPagesModal();
    });
  dom.pagesModal?.addEventListener("mousedown", (e) => {
    if (e.target === dom.pagesModal) dom.pagesModal.classList.add("hidden");
  });
  dom.pagesModalSearch?.addEventListener("input", () =>
    renderPagesModalList(dom.pagesModalSearch.value),
  );
  dom.pagesModalSearch?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusModalItem(visibleModalItems()[0] ?? null);
    }
  });
  // Refresh card stats on every hover so counts are always current.
  document
    .getElementById("page-card")
    ?.addEventListener("mouseenter", () => updatePageCard());
  document
    .getElementById("page-card-title")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      startCardRename();
    });
  document
    .getElementById("page-desc")
    ?.addEventListener("click", (e) => {
      e.stopPropagation();
      startDescEdit();
    });
  const list = document.getElementById("tabs-list");
  list?.addEventListener("dragstart", (e) => {
    const tab = e.target.closest?.(".tab");
    if (!tab) {
      e.preventDefault();
      return;
    }
    dragPageId = tab.dataset.id;
    dragTabEl = tab;
    e.dataTransfer.effectAllowed = "move";
    try {
      e.dataTransfer.setData("text/plain", dragPageId);
    } catch (_) {
      /* Firefox requires setData to start dragging */
    }
    // The native drag image snapshots the source, so translucency set
    // here (inline, independent of stylesheet caching) travels with the
    // item under the pointer. The tab itself leaves the list on the
    // first dragover below — hiding it here would cancel the drag.
    tab.style.opacity = "0.35";
    ensureMarker();
  });
  list?.addEventListener("dragover", (e) => {
    if (!dragPageId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // The drag is safely underway now: remove the tab from the list.
    if (dragTabEl && dragTabEl.style.display !== "none") {
      dragTabEl.style.display = "none";
    }
    const tab = e.target.closest?.(".tab");
    if (!tab || tab.dataset.id === dragPageId) {
      dropTarget = { append: true };
      const lr = list.getBoundingClientRect();
      positionMarker(lr.left, lr.top, lr.height);
      return;
    }
    // RTL bar: the right edge means "before", the left edge "after".
    const r = tab.getBoundingClientRect();
    const after = e.clientX < r.left + r.width / 2;
    positionMarker(
      after ? r.left : r.right,
      r.top,
      r.height,
    );
    dropTarget = { id: tab.dataset.id, after };
  });
  list?.addEventListener("dragleave", () => {
    if (markerEl) markerEl.classList.add("hidden");
  });
  list?.addEventListener("drop", (e) => {
    e.preventDefault();
    if (dragPageId && dropTarget) movePage(dragPageId, dropTarget);
    cleanupDrag();
  });
  list?.addEventListener("dragend", () => cleanupDrag());
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
