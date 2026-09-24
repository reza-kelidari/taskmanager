/**
 * @module db
 * @description Data layer: IndexedDB persistence plus every mutation of
 * the node graph — status flags, parent-input bookkeeping, and the
 * independence operator family.
 */
import { state } from "./state.js";
import { dom } from "./dom.js";
import { showToast, isAncestorMulti, hasInputFrom } from "./utils.js";
import { errorReporter } from "./error.js";

/**
 * Opens (or creates) the IndexedDB database and restores the saved canvas
 * pan offset from localStorage. Version 2 adds the `history` store for
 * the undo/redo stack (v1 only had `nodes`).
 *
 * @returns {Promise<void>} Resolves when the DB handle is ready.
 * @rejects {Error} When the database cannot be opened.
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open("TaskManagerDB", 2);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains("nodes")) {
          database.createObjectStore("nodes", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("history")) {
          database.createObjectStore("history", { keyPath: "id" });
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

/**
 * Upserts a node into the object store.
 *
 * @param {object} node Node record (keyed by `id`).
 * @returns {void}
 */
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

/**
 * Deletes a node record by id.
 *
 * @param {string} id Node id.
 * @returns {void}
 */
export function deleteNodeDB(id) {
  try {
    if (!state.db) return;
    const tx = state.db.transaction("nodes", "readwrite");
    tx.objectStore("nodes").delete(id);
  } catch (error) {
    errorReporter.report(error, { context: "deleteNodeDB", nodeId: id });
  }
}

/**
 * Loads every node record from the store.
 *
 * @returns {Promise<Array<object>>} All stored nodes; empty array on failure.
 */
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

/**
 * Persists the undo/redo stack as a single `history` record (id "stack").
 *
 * @param {Array<object>} stack History entries (deep-copied snapshots).
 * @param {number} currentIndex Index of the current state within the stack.
 * @returns {Promise<boolean>} True when the write was accepted.
 */
export function saveHistory(stack, currentIndex) {
  return new Promise((resolve) => {
    try {
      if (!state.db || !state.db.objectStoreNames.contains("history")) {
        resolve(false);
        return;
      }
      const tx = state.db.transaction("history", "readwrite");
      tx.objectStore("history").put({ id: "stack", stack, currentIndex });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (error) {
      errorReporter.report(error, { context: "saveHistory" });
      resolve(false);
    }
  });
}

/**
 * Loads the persisted undo/redo stack.
 *
 * @returns {Promise<{stack: Array<object>, currentIndex: number}|null>}
 *   The stored payload, or null when absent/unavailable.
 */
export function loadHistory() {
  return new Promise((resolve) => {
    try {
      if (!state.db || !state.db.objectStoreNames.contains("history")) {
        resolve(null);
        return;
      }
      const tx = state.db.transaction("history", "readonly");
      const request = tx.objectStore("history").get("stack");
      request.onsuccess = (e) => resolve(e.target.result || null);
      request.onerror = () => resolve(null);
    } catch (error) {
      errorReporter.report(error, { context: "loadHistory" });
      resolve(null);
    }
  });
}

/**
 * Sets the "done" flag of a task. This is a pure status mutation — the
 * graph structure is never touched here:
 *
 * - Marking done also marks every task ancestor up the primary chain
 *   done (clearing `cancelled`/`suspended` on any of them; the three
 *   states are exclusive). Headers are never marked.
 * - Un-marking simply clears the flag. Detaching children is exclusively
 *   the cancelled feature's job (the independence operator) — an older
 *   version of this branch promoted direct children to the node's
 *   parent, which silently restructured the graph on a status toggle.
 *
 * @param {object} node Task node (mutated in place).
 * @param {boolean} doneStatus Target state.
 * @returns {void}
 */
export function setNodeDoneStatus(node, doneStatus) {
  if (node.type !== "task") return;
  if (doneStatus) {
    node.done = true;
    if (node.cancelled) node.cancelled = false;
    if (node.suspended) node.suspended = false;
    saveNode(node);
    let current = node;
    while (current.parent) {
      let parent = state.nodes.find((n) => n.id == current.parent);
      if (parent && parent.type === "task" && !parent.done) {
        parent.done = true;
        if (parent.cancelled) parent.cancelled = false;
        if (parent.suspended) parent.suspended = false;
        saveNode(parent);
      }
      current = parent;
    }
  } else {
    node.done = false;
    saveNode(node);
  }
}

/* ============================================================
 * Parent-input mutations (multi-input graph)
 * ============================================================ */

/**
 * Adds `parentId` as a new input of `node`. The first input a node ever
 * receives becomes its primary parent (layout-defining); every further
 * input is appended to `extraParents` as a visual/data thread only.
 *
 * @param {object} node Receiving node (mutated in place).
 * @param {string} parentId Id of the feeding node.
 * @returns {boolean} True when a new input was added; false when it
 *   already existed (duplicate).
 */
export function addParentInput(node, parentId) {
  if (hasInputFrom(node, parentId)) return false;
  if (node.parent === null || node.parent === undefined) {
    node.parent = parentId;
  } else {
    if (!Array.isArray(node.extraParents)) node.extraParents = [];
    node.extraParents.push(parentId);
  }
  if (!Array.isArray(node.extraParents)) node.extraParents = [];
  saveNode(node);
  return true;
}

/**
 * Removes the input coming from `parentId`. Removing the primary parent
 * promotes the first extra parent into the primary slot; when no extra
 * inputs remain the node becomes a root.
 *
 * @param {object} node Receiving node (mutated in place).
 * @param {string} parentId Id of the feeding node to detach.
 * @returns {void}
 */
export function removeParentInput(node, parentId) {
  if (node.parent != null && String(node.parent) === String(parentId)) {
    if (Array.isArray(node.extraParents) && node.extraParents.length > 0) {
      node.parent = node.extraParents.shift();
    } else {
      node.parent = null;
    }
  } else if (Array.isArray(node.extraParents)) {
    node.extraParents = node.extraParents.filter(
      (id) => String(id) !== String(parentId),
    );
  }
  if (!Array.isArray(node.extraParents)) node.extraParents = [];
  saveNode(node);
}

/**
 * Replaces the input currently coming from `oldParentId` with
 * `newParentId` in the same slot (the primary parent stays primary), then
 * deduplicates the resulting input list.
 *
 * @param {object} node Receiving node (mutated in place).
 * @param {string} oldParentId Feeding node to replace.
 * @param {string} newParentId Feeding node to substitute in.
 * @returns {void}
 */
export function replaceParentInput(node, oldParentId, newParentId) {
  if (node.parent != null && String(node.parent) === String(oldParentId)) {
    node.parent = newParentId;
  } else if (Array.isArray(node.extraParents)) {
    const i = node.extraParents.findIndex(
      (id) => String(id) === String(oldParentId),
    );
    if (i >= 0) node.extraParents[i] = newParentId;
    else node.extraParents.push(newParentId);
  }
  if (!Array.isArray(node.extraParents)) node.extraParents = [];
  const primary = node.parent != null ? String(node.parent) : null;
  node.extraParents = node.extraParents.filter(
    (id, i, arr) =>
      arr.findIndex((x) => String(x) === String(id)) === i &&
      String(id) !== primary,
  );
  saveNode(node);
}

/* ============================================================
 * Independence operator family
 * ============================================================ */

/**
 * The independence operator: detaches `childNode` from its current primary
 * parent and attaches it to `newParentNode`, lifting the node and its
 * whole subtree one level up.
 *
 *   A > B > C   with   independence(C, A)   ⟹   A > C  and  A > B
 *
 * Self-contained validation (independent of `canConnectRaw`):
 * - No self-connection.
 * - Type compatibility: a task cannot adopt a non-task child.
 * - No cycle: the new parent must not be a descendant of the child.
 *   Connecting to an ancestor — the very thing this operator does — is
 *   always cycle-free and therefore allowed.
 *
 * @param {object} childNode Node to lift (mutated in place).
 * @param {object|null} newParentNode New primary parent; null detaches
 *   the child completely (becomes a root).
 * @returns {boolean} True when the graph changed; false when the request
 *   was invalid or a no-op.
 */
export function independence(childNode, newParentNode) {
  if (!childNode) return false;

  if (newParentNode) {
    if (String(newParentNode.id) === String(childNode.id)) return false;

    if (newParentNode.type === "task" && childNode.type !== "task") {
      return false;
    }

    if (isAncestorMulti(childNode.id, newParentNode.id)) return false;
  }

  const newParentId = newParentNode ? newParentNode.id : null;

  if (
    newParentId == null
      ? childNode.parent == null
      : String(childNode.parent ?? "") === String(newParentId)
  ) {
    return false;
  }

  childNode.parent = newParentId;
  if (!Array.isArray(childNode.extraParents)) childNode.extraParents = [];
  if (newParentId != null) {
    childNode.extraParents = childNode.extraParents.filter(
      (id) => String(id) !== String(newParentId),
    );
  }
  saveNode(childNode);
  return true;
}

/**
 * Runs the independence operator on a node's behalf: every direct child
 * (first argument) is lifted to this node's own parent (second argument).
 * Nodes that merely hold an *extra* input from this node have that slot
 * replaced with the new parent (or removed when there is none).
 *
 * @param {object} node Node whose children should be lifted.
 * @returns {boolean} True when anything changed.
 */
export function runIndependencer(node) {
  if (!node) return false;
  const newParent = node.parent
    ? (state.nodes.find((n) => String(n.id) === String(node.parent)) ?? null)
    : null;

  let changed = false;

  state.nodes
    .filter((n) => String(n.parent) === String(node.id))
    .forEach((child) => {
      if (independence(child, newParent)) changed = true;
    });

  state.nodes.forEach((n) => {
    if (!Array.isArray(n.extraParents)) return;
    const idx = n.extraParents.findIndex(
      (id) => String(id) === String(node.id),
    );
    if (idx < 0) return;

    n.extraParents.splice(idx, 1);
    if (newParent) {
      const alreadyHas =
        String(n.parent ?? "") === String(newParent.id) ||
        n.extraParents.some((id) => String(id) === String(newParent.id));
      if (!alreadyHas) n.extraParents.push(newParent.id);
    }
    saveNode(n);
    changed = true;
  });

  return changed;
}

/**
 * Sets the "cancelled" state of a task. Cancelling clears `done` and
 * `suspended` (the three states are mutually exclusive) and runs the
 * independence operator so the task's children attach directly to its
 * parent. Un-cancelling only clears the flag — the graph is intentionally
 * left as-is.
 *
 * @param {object} node Task node (mutated in place).
 * @param {boolean} cancelled Target state.
 * @returns {void}
 */
export function setNodeCancelledStatus(node, cancelled) {
  if (node.type !== "task") return;
  node.cancelled = !!cancelled;
  if (node.cancelled) {
    node.done = false;
    node.suspended = false;
  }
  saveNode(node);
  if (node.cancelled) {
    runIndependencer(node);
  }
}

/**
 * Sets the "suspended" state of a task. Suspending clears `done` and
 * `cancelled` (the three states are mutually exclusive) but never
 * touches the graph structure — children stay attached. Un-suspending
 * only clears the flag.
 *
 * @param {object} node Task node (mutated in place).
 * @param {boolean} suspended Target state.
 * @returns {void}
 */
export function setNodeSuspendedStatus(node, suspended) {
  if (node.type !== "task") return;
  node.suspended = !!suspended;
  if (node.suspended) {
    node.done = false;
    node.cancelled = false;
  }
  saveNode(node);
}
