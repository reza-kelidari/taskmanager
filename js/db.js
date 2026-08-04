import { state } from "./state.js";
import { dom } from "./dom.js";
import { showToast } from "./utils.js";
import { errorReporter } from "./error.js";

export function initDB() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open("TaskManagerDB", 1);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains("nodes")) {
          database.createObjectStore("nodes", { keyPath: "id" });
        }
      };
      request.onsuccess = (e) => {
        state.db = e.target.result;
        const savedX = parseInt(localStorage.getItem("canvasX"));
        const savedY = parseInt(localStorage.getItem("canvasY"));
        dom.canvas.style.left = `${isNaN(savedX) ? window.innerWidth / 2 : savedX}px`;
        dom.canvas.style.top = `${isNaN(savedY) ? window.innerHeight / 2 : savedY}px`;
        resolve();
      };
      request.onerror = () => {
        const error = new Error("Failed to open IndexedDB");
        errorReporter.report(error, { context: "initDB" });
        showToast("خطا در اتصال به پایگاه داده", "error");
        reject(error);
      };
    } catch (error) {
      errorReporter.report(error, { context: "initDB" });
      reject(error);
    }
  });
}

export function saveNode(node) {
  try {
    if (!state.db) {
      console.error("DB not initialized");
      return;
    }
    const tx = state.db.transaction("nodes", "readwrite");
    tx.objectStore("nodes").put(node);
  } catch (error) {
    errorReporter.report(error, { context: "saveNode", nodeId: node.id });
  }
}

export function deleteNodeDB(id) {
  try {
    if (!state.db) return;
    const tx = state.db.transaction("nodes", "readwrite");
    tx.objectStore("nodes").delete(id);
  } catch (error) {
    errorReporter.report(error, { context: "deleteNodeDB", nodeId: id });
  }
}

export function loadNodes() {
  return new Promise((resolve) => {
    try {
      if (!state.db) {
        resolve([]);
        return;
      }
      const tx = state.db.transaction("nodes", "readonly");
      const store = tx.objectStore("nodes");
      const request = store.getAll();
      request.onsuccess = (e) => {
        resolve(e.target.result || []);
      };
      request.onerror = () => resolve([]);
    } catch (error) {
      errorReporter.report(error, { context: "loadNodes" });
      resolve([]);
    }
  });
}

export function setNodeDoneStatus(node, doneStatus) {
  if (node.type !== "task") return;
  if (doneStatus) {
    node.done = true;
    saveNode(node);
    let current = node;
    while (current.parent) {
      let parent = state.nodes.find((n) => n.id == current.parent);
      if (parent && parent.type === "task" && !parent.done) {
        parent.done = true;
        saveNode(parent);
      }
      current = parent;
    }
  } else {
    node.done = false;
    saveNode(node);
    state.nodes
      .filter((n) => n.parent == node.id)
      .forEach((child) => {
        child.parent = node.parent;
        saveNode(child);
      });
  }
}
