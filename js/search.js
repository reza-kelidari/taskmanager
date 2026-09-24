/**
 * @module search
 * @description Title/description/notes search modal with click-to-focus
 * navigation.
 */
import { state } from "./state.js";
import { dom, positionFloating } from "./dom.js";
import { debounce } from "./utils.js";
import { getRenderedEl } from "./renderer.js";

/**
 * Opens the search modal, centered on the viewport, with previous results
 * cleared.
 * @returns {void}
 */
export function showSearchModal() {
  dom.searchModal.classList.remove("hidden");
  dom.searchInput.value = "";
  dom.searchResults.innerHTML = "";
  dom.searchInput.focus();
  positionFloating(
    dom.searchModal,
    window.innerWidth / 2 - 150,
    window.innerHeight / 2 - 100,
  );
}

/**
 * Renders the result list for a query. Matches titles, descriptions and
 * note texts (case-insensitive). Each result focuses its node on click.
 *
 * @param {string} query Raw input value.
 * @returns {void}
 */
export function performSearch(query) {
  dom.searchResults.innerHTML = "";
  if (!query.trim()) return;
  const searchTerm = query.toLowerCase();
  const results = state.nodes.filter(
    (n) =>
      n.title.toLowerCase().includes(searchTerm) ||
      (n.note && n.note.toLowerCase().includes(searchTerm)) ||
      (n.notes &&
        n.notes.some((note) => note.text.toLowerCase().includes(searchTerm))),
  );
  if (results.length === 0) {
    const el = document.createElement("div");
    el.className = "search-no-result";
    el.textContent = "نتیجه‌ای یافت نشد";
    dom.searchResults.appendChild(el);
    return;
  }
  results.forEach((node) => {
    const item = document.createElement("div");
    item.className = "search-result-item";
    item.tabIndex = 0;
    const title = document.createElement("div");
    title.className = "search-result-title";
    title.textContent = node.title;
    const type = document.createElement("div");
    type.className = "search-result-type";
    type.textContent =
      node.type === "header"
        ? "سرفصل"
        : node.done
          ? "انجام‌شده"
          : node.cancelled
            ? "لغوشده"
            : node.suspended
              ? "تعلیق‌شده"
              : "وظیفه";
    item.appendChild(title);
    item.appendChild(type);
    item.addEventListener("click", () => {
      focusNode(node.id);
      dom.searchModal.classList.add("hidden");
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        focusNode(node.id);
        dom.searchModal.classList.add("hidden");
      }
    });
    dom.searchResults.appendChild(item);
  });
}

/**
 * Pans the canvas so the node is centered on the viewport and plays the
 * highlight pulse on it.
 *
 * @param {string} nodeId Node id to focus.
 * @returns {void}
 */
export function focusNode(nodeId) {
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const centerX = node.x + 75;
  const centerY = node.y + 20;
  dom.canvas.style.transition = "left 0.3s ease, top 0.3s ease";
  dom.canvas.style.left = `${window.innerWidth / 2 - centerX}px`;
  dom.canvas.style.top = `${window.innerHeight / 2 - centerY}px`;
  localStorage.setItem("canvasX", window.innerWidth / 2 - centerX);
  localStorage.setItem("canvasY", window.innerHeight / 2 - centerY);
  setTimeout(() => {
    dom.canvas.style.transition = "";
    const el = getRenderedEl(nodeId);
    if (el) {
      el.classList.add("highlight");
      setTimeout(() => el.classList.remove("highlight"), 2000);
    }
  }, 350);
}

/** Debounced search input handler. */
export const debouncedSearch = debounce((e) => performSearch(e.target.value));
