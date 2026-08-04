import { state } from "./state.js";
import { dom, hideAllMenus, hideAllModals, positionFloating } from "./dom.js";
import { history } from "./history.js";
import { saveNode, deleteNodeDB, setNodeDoneStatus } from "./db.js";
import { drawConnections } from "./drag.js";
import { showSearchModal, debouncedSearch } from "./search.js";
import { showNotesMenu, openNoteModal, saveNote } from "./notes.js";
import { showInputModal, saveInput } from "./modals.js";

export function setupEvents(
  renderNodesFn,
  autoArrangeFn,
  undoFn,
  redoFn,
  toggleDarkModeFn,
  exportDataFn,
) {
  document
    .getElementById("tool-arrange")
    .addEventListener("click", autoArrangeFn);
  document.getElementById("tool-undo").addEventListener("click", undoFn);
  document.getElementById("tool-redo").addEventListener("click", redoFn);
  document
    .getElementById("tool-search")
    .addEventListener("click", showSearchModal);

  document.getElementById("tool-more").addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    positionFloating(dom.moreMenu, rect.left, rect.bottom + 16);
  });

  document.querySelectorAll("#more-menu .menu-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      if (action === "dark-mode") toggleDarkModeFn();
      if (action === "export") exportDataFn();
      if (action === "import") dom.fileImport.click();
      dom.moreMenu.classList.add("hidden");
    });
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        item.click();
      }
    });
  });

  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    hideAllMenus();
    hideAllModals();

    const nodeEl = e.target.closest(".node");

    if (nodeEl) {
      state.activeEl = nodeEl;
      const nodeData = state.nodes.find((n) => n.id == nodeEl.dataset.id);
      if (!nodeData) return;
      const toggleItem = dom.elementMenu.querySelector(
        '[data-action="toggle-done"]',
      );
      const notesItem = dom.elementMenu.querySelector(
        '[data-action="comments"]',
      );
      if (nodeData.type === "task") {
        toggleItem.style.display = "flex";
        toggleItem.innerText = nodeData.done ? "انجام نشده" : "انجام شده";
        notesItem.style.display = "flex";
        notesItem.innerText = "یادداشت‌ها";
      } else {
        toggleItem.style.display = "none";
        notesItem.style.display = "none";
      }
      positionFloating(dom.elementMenu, e.clientX, e.clientY);
    } else if (e.target.closest("#canvas-wrapper")) {
      state.activeEl = null;
      const taskItem = dom.contextMenu.querySelector(
        '[data-action="new-task"]',
      );
      taskItem.classList.toggle(
        "disabled",
        !state.nodes.some((n) => n.type === "header"),
      );
      positionFloating(dom.contextMenu, e.clientX, e.clientY);
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (
      !e.target.closest(".context-menu") &&
      !e.target.closest(".modal-content") &&
      !e.target.closest("#tool-more")
    ) {
      hideAllMenus();
      hideAllModals();
      state.editingNodeId = null;
    }
  });

  document
    .querySelectorAll(".context-menu .menu-item[data-action]")
    .forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (item.classList.contains("disabled")) return;
        const action = item.dataset.action;
        const menu = item.closest(".context-menu");
        const x = parseInt(menu.style.left);
        const y = parseInt(menu.style.top);

        if (menu.id === "context-menu") {
          if (action === "new-header") showInputModal("header", x, y);
          if (action === "new-task") showInputModal("task", x, y);
          hideAllMenus();
        } else if (menu.id === "element-menu") {
          const nodeId = state.activeEl.dataset.id;
          const node = state.nodes.find((n) => n.id == nodeId);
          if (action === "edit") {
            showInputModal(node.type, x, y, node);
            hideAllMenus();
          }
          if (action === "delete") {
            const parentId = node.parent;
            state.nodes
              .filter((n) => n.parent == nodeId)
              .forEach((child) => {
                child.parent = parentId;
                saveNode(child);
              });
            state.nodes = state.nodes.filter((n) => n.id != nodeId);
            deleteNodeDB(nodeId);
            history.push(state.nodes);
            renderNodesFn();
            drawConnections();
            hideAllMenus();
          }
          if (action === "toggle-done") {
            setNodeDoneStatus(node, !node.done);
            history.push(state.nodes);
            renderNodesFn();
            autoArrangeFn();
            hideAllMenus();
          }
          if (action === "comments") {
            state.currentNoteNodeId = nodeId;
            showNotesMenu(x, y, node);
            dom.elementMenu.classList.add("hidden");
          }
        }
      });
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          item.click();
        }
      });
    });

  document.getElementById("back-from-notes").addEventListener("click", (e) => {
    e.stopPropagation();
    const x = parseInt(dom.notesMenu.style.left);
    const y = parseInt(dom.notesMenu.style.top);
    dom.notesMenu.classList.add("hidden");
    if (state.activeEl) positionFloating(dom.elementMenu, x, y);
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    const result = saveInput();
    if (result) {
      renderNodesFn();
      drawConnections();
    }
  });

  document
    .getElementById("add-note-btn")
    .addEventListener("click", () => openNoteModal(false, -1, ""));
  document.getElementById("save-note-btn").addEventListener("click", () => {
    saveNote();
  });

  document.getElementById("confirm-yes").addEventListener("click", () => {
    if (state.pendingDeleteAction) {
      state.pendingDeleteAction();
    }
  });
  document.getElementById("confirm-no").addEventListener("click", () => {
    dom.confirmModal.classList.add("hidden");
    state.pendingDeleteAction = null;
    if (state.currentNoteNodeId) {
      const node = state.nodes.find((n) => n.id == state.currentNoteNodeId);
      const x = parseInt(dom.confirmModal.style.left);
      const y = parseInt(dom.confirmModal.style.top);
      if (node) showNotesMenu(x, y, node);
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      e.preventDefault();
      undoFn();
      return;
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === "y" || (e.key === "z" && e.shiftKey))
    ) {
      e.preventDefault();
      redoFn();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      showSearchModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      exportDataFn();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "i") {
      e.preventDefault();
      dom.fileImport.click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "d") {
      e.preventDefault();
      toggleDarkModeFn();
      return;
    }
    if (e.key === "Escape") {
      hideAllMenus();
      hideAllModals();
      state.editingNodeId = null;
      return;
    }
    if (e.key === "Enter" && !dom.inputModal.classList.contains("hidden")) {
      if (e.target.tagName !== "TEXTAREA" || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        document.getElementById("btn-save").click();
      }
    } else if (
      e.key === "Enter" &&
      !dom.noteModal.classList.contains("hidden")
    ) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        document.getElementById("save-note-btn").click();
      }
    } else if (
      e.key === "Enter" &&
      !dom.searchModal.classList.contains("hidden")
    ) {
      e.preventDefault();
      const firstResult = dom.searchResults.querySelector(
        ".search-result-item",
      );
      if (firstResult) firstResult.click();
    }
  });

  dom.searchInput.addEventListener("input", debouncedSearch);

  dom.toastContainer.addEventListener("mouseenter", () => {
    state.isToastPaused = true;
    state.toastTimers.forEach((t) => {
      clearTimeout(t.timerId);
      t.remaining -= Date.now() - t.startTime;
      if (t.remaining < 0) t.remaining = 0;
    });
  });
  dom.toastContainer.addEventListener("mouseleave", () => {
    state.isToastPaused = false;
    state.toastTimers.forEach((t) => {
      t.startTime = Date.now();
      t.timerId = setTimeout(() => removeToast(t.element), t.remaining);
    });
  });

  document
    .getElementById("canvas-wrapper")
    .addEventListener("mousedown", (e) => {
      if (e.target.closest(".node") || e.target.closest(".connection-point"))
        return;
      state.panData = {
        startX: e.clientX,
        startY: e.clientY,
        initLeft: parseInt(dom.canvas.style.left || 0),
        initTop: parseInt(dom.canvas.style.top || 0),
      };
      document.addEventListener("mousemove", handlePan);
      document.addEventListener("mouseup", endPan);
    });

  dom.fileImport.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      importData(file, renderNodesFn);
      e.target.value = "";
    }
  });
}

function handlePan(e) {
  if (!state.panData) return;
  dom.canvas.style.left = `${state.panData.initLeft + (e.clientX - state.panData.startX)}px`;
  dom.canvas.style.top = `${state.panData.initTop + (e.clientY - state.panData.startY)}px`;
}

function endPan() {
  localStorage.setItem("canvasX", parseInt(dom.canvas.style.left) || 0);
  localStorage.setItem("canvasY", parseInt(dom.canvas.style.top) || 0);
  state.panData = null;
  document.removeEventListener("mousemove", handlePan);
  document.removeEventListener("mouseup", endPan);
}

function importData(file, renderNodesFn) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.nodes || !Array.isArray(data.nodes))
        throw new Error("Invalid file format");
      state.nodes.forEach((n) => deleteNodeDB(n.id));
      state.nodes = data.nodes.map((node) => ({
        ...node,
        notes: node.notes || [],
      }));
      state.nodes.forEach((n) => saveNode(n));
      history.push(state.nodes);
      renderNodesFn();
    } catch (error) {
      console.error("Import failed:", error);
    }
  };
  reader.readAsText(file);
}

function removeToast(toastEl) {
  if (!toastEl || !toastEl.parentNode) return;
  const timerObj = toastEl._timerObj;
  if (timerObj) {
    clearTimeout(timerObj.timerId);
    const idx = state.toastTimers.indexOf(timerObj);
    if (idx > -1) state.toastTimers.splice(idx, 1);
  }
  toastEl.classList.add("toast-exit");
  setTimeout(() => {
    if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
  }, 300);
}
