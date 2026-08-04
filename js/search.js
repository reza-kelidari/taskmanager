import { state } from "./state.js";
import { dom, positionFloating } from "./dom.js";
import { debounce } from "./utils.js";
import { getRenderedEl } from "./renderer.js";

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
      node.type === "header" ? "سرفصل" : node.done ? "انجام شده" : "وظیفه";
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

export const debouncedSearch = debounce((e) => performSearch(e.target.value));
