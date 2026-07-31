/**
 * @typedef {Object} Note
 * @property {string} text - The content of the note.
 * @property {string} date - Shamsi date string.
 * @property {string} time - Time string.
 */

/**
 * @typedef {Object} Node
 * @property {string} id - Unique identifier for the node.
 * @property {'header'|'task'} type - Type of the node.
 * @property {string} title - The title of the node.
 * @property {string} [note] - Description for tasks.
 * @property {boolean} [done] - Completion status for tasks.
 * @property {string|null} parent - ID of the parent node.
 * @property {Note[]} [notes] - Array of notes attached to the task.
 * @property {number} x - X coordinate on canvas.
 * @property {number} y - Y coordinate on canvas.
 */

/**
 * @typedef {Object} Group
 * @property {string} id - Group identifier (e.g., 'group_123').
 * @property {'group'} type - Type indicator.
 * @property {number} count - Number of nodes in the group.
 * @property {Node[]} nodes - Array of nodes in the group.
 * @property {number} x - X coordinate on canvas.
 * @property {number} y - Y coordinate on canvas.
 * @property {string|null} parent - Parent of the first node in the group.
 */

/**
 * @typedef {Object} DragData
 * @property {'move-node'|'new-connection'|'move-connection'} type - Type of drag action.
 * @property {HTMLElement} [el] - The element being dragged.
 * @property {number} [startX] - Initial mouse X position.
 * @property {number} [startY] - Initial mouse Y position.
 * @property {number} [initX] - Initial element X position.
 * @property {number} [initY] - Initial element Y position.
 * @property {boolean} [moved] - Whether the element was actually moved.
 * @property {Node} [sourceNode] - Source node for connections.
 * @property {Node} [targetNode] - Target node for moving connections.
 * @property {SVGPathElement} [tempLine] - Temporary SVG path during connection drag.
 */

/** @type {Object<string, HTMLElement | NodeListOf<HTMLElement>>} */
const dom = {
  canvas: document.getElementById("canvas"),
  svgLayer: document.getElementById("connections-layer"),
  dateDisplay: document.getElementById("date-display"),
  emptyState: document.getElementById("empty-state"),
  hoverBox: document.getElementById("hover-box"),
  contextMenu: document.getElementById("context-menu"),
  elementMenu: document.getElementById("element-menu"),
  notesMenu: document.getElementById("notes-menu"),
  inputModal: document.getElementById("input-modal"),
  noteModal: document.getElementById("note-modal"),
  confirmModal: document.getElementById("confirm-modal"),
  inputTitle: document.getElementById("input-title"),
  inputNote: document.getElementById("input-note"),
  noteTextInput: document.getElementById("note-text-input"),
  notesList: document.getElementById("notes-list"),
  toolBtns: document.querySelectorAll(".tool-btn:not(#tool-arrange)"),
  groupTooltip: document.getElementById("group-tooltip"),
};

/** @type {IDBDatabase} */
let db;
/** @type {Node[]} */
let nodes = [];
/** @type {'pan'|'move'} */
let currentMode = "pan";
/** @type {HTMLElement|null} */
let activeEl = null;
/** @type {DragData|null} */
let dragData = null;
/** @type {boolean} */
let isDrawing = false;

/** @type {string|null} */
let editingNodeId = null;
/** @type {string|null} */
let currentNoteNodeId = null;
/** @type {number} */
let editingNoteIndex = -1;
/** @type {Function|null} */
let pendingDeleteAction = null;

/** @type {Node[][]} */
let groups = [];
/** @type {Set<string>} */
let groupedIds = new Set();
/** @type {Object<string, Group>} */
let groupMap = {};

/**
 * Initializes the IndexedDB database.
 * @returns {Promise<void>}
 */
function initDB() {
  return new Promise((resolve) => {
    const request = indexedDB.open("TaskManagerDB", 1);
    request.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains("nodes")) {
        database.createObjectStore("nodes", { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      const savedX = parseInt(localStorage.getItem("canvasX"));
      const savedY = parseInt(localStorage.getItem("canvasY"));
      dom.canvas.style.left = `${isNaN(savedX) ? window.innerWidth / 2 : savedX}px`;
      dom.canvas.style.top = `${isNaN(savedY) ? window.innerHeight / 2 : savedY}px`;
      loadNodes();
      resolve();
    };
  });
}

/**
 * Loads nodes from the database and renders them.
 * @returns {void}
 */
function loadNodes() {
  const tx = db.transaction("nodes", "readonly");
  const store = tx.objectStore("nodes");
  store.getAll().onsuccess = (e) => {
    nodes = e.target.result || [];

    nodes.forEach((node) => {
      if (!node.notes) node.notes = [];
    });

    if (nodes.length === 0) {
      dom.emptyState.style.display = "block";
    } else {
      dom.emptyState.style.display = "none";
      renderNodes();
      drawConnections();
    }
  };
}

/**
 * Saves or updates a node in the database.
 * @param {Node} node - The node to save.
 * @returns {void}
 */
function saveNode(node) {
  const tx = db.transaction("nodes", "readwrite");
  tx.objectStore("nodes").put(node);
}

/**
 * Deletes a node from the database.
 * @param {string} id - The ID of the node to delete.
 * @returns {void}
 */
function deleteNodeDB(id) {
  const tx = db.transaction("nodes", "readwrite");
  tx.objectStore("nodes").delete(id);
}

/**
 * Gets the current Shamsi date string.
 * @returns {string}
 */
function getShamsiDate() {
  return new Date().toLocaleDateString("fa-IR", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Gets the current time string.
 * @returns {string}
 */
function getCurrentTime() {
  return new Date().toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Hides all context menus. @returns {void} */
function hideAllMenus() {
  dom.contextMenu.classList.add("hidden");
  dom.elementMenu.classList.add("hidden");
  dom.notesMenu.classList.add("hidden");
}

/** Hides all modal dialogs. @returns {void} */
function hideAllModals() {
  dom.inputModal.classList.add("hidden");
  dom.noteModal.classList.add("hidden");
  dom.confirmModal.classList.add("hidden");
}

/** Hides the group tooltip. @returns {void} */
function hideGroupTooltip() {
  dom.groupTooltip.classList.add("hidden");
  dom.groupTooltip.innerHTML = "";
}

/**
 * Gets the rendered DOM element for a node or its group.
 * @param {string} nodeId - The ID of the node.
 * @returns {HTMLElement|null}
 */
function getRenderedEl(nodeId) {
  if (groupedIds.has(nodeId)) {
    const group = Object.values(groupMap).find((g) =>
      g.nodes.some((n) => n.id == nodeId),
    );
    if (group) return dom.canvas.querySelector(`.node[data-id="${group.id}"]`);
  }
  return dom.canvas.querySelector(`.node[data-id="${nodeId}"]`);
}

/**
 * Gets the visual node (group or node) for calculations.
 * @param {string} nodeId - The ID of the node.
 * @returns {Node|Group|undefined}
 */
function getVisualNode(nodeId) {
  if (groupMap[nodeId]) return groupMap[nodeId];
  const group = Object.values(groupMap).find((g) =>
    g.nodes.some((n) => n.id == nodeId),
  );
  if (group) return group;
  return nodes.find((n) => n.id == nodeId);
}

/**
 * Gets visible children for layout calculations.
 * @param {Node} node - The parent node.
 * @returns {Node[]}
 */
function getLayoutChildren(node) {
  let visibleChildren = [];
  const directChildren = nodes.filter((n) => n.parent === node.id);
  directChildren.forEach((child) => {
    if (groupedIds.has(child.id) && !groupMap[child.id]) {
      visibleChildren = visibleChildren.concat(getLayoutChildren(child));
    } else {
      visibleChildren.push(child);
    }
  });
  return visibleChildren;
}

dom.dateDisplay.innerText = getShamsiDate();

/** Event listener for tool buttons to switch modes. */
dom.toolBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    dom.toolBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.id.split("-")[1];
    document.body.className = `mode-${currentMode}`;
  });
});

/** Event listener for auto arrange button. */
document.getElementById("tool-arrange").addEventListener("click", autoArrange);

/** Event listener for right-click context menu. */
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  hideAllMenus();
  hideAllModals();

  const nodeEl = e.target.closest(".node");
  const isInsideTooltip = dom.groupTooltip.contains(e.target);

  if (
    !isInsideTooltip &&
    !(nodeEl && nodeEl.classList.contains("group-node"))
  ) {
    hideGroupTooltip();
  }

  if (nodeEl && !nodeEl.classList.contains("group-node")) {
    activeEl = nodeEl;
    const nodeData = nodes.find((n) => n.id == nodeEl.dataset.id);
    if (!nodeData) return;

    const toggleItem = dom.elementMenu.querySelector(
      '[data-action="toggle-done"]',
    );
    const notesItem = dom.elementMenu.querySelector('[data-action="comments"]');

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
  } else if (!isInsideTooltip && e.target.closest("#canvas-wrapper")) {
    activeEl = null;
    const taskItem = dom.contextMenu.querySelector('[data-action="new-task"]');
    taskItem.classList.toggle(
      "disabled",
      !nodes.some((n) => n.type === "header"),
    );

    positionFloating(dom.contextMenu, e.clientX, e.clientY);
  }
});

/** Event listener to close menus when clicking outside. */
document.addEventListener("mousedown", (e) => {
  if (
    !dom.groupTooltip.contains(e.target) &&
    !e.target.closest(".group-node") &&
    !e.target.closest(".context-menu") &&
    !e.target.closest(".modal-content")
  ) {
    hideGroupTooltip();
  }

  if (
    !e.target.closest(".context-menu") &&
    !e.target.closest(".modal-content")
  ) {
    hideAllMenus();
    hideAllModals();
    editingNodeId = null;
  }
});

/** Event listeners for context menu items. */
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
        const nodeId = activeEl.dataset.id;
        const node = nodes.find((n) => n.id == nodeId);

        if (action === "edit") {
          showInputModal(node.type, x, y, node);
          hideAllMenus();
        }
        if (action === "delete") {
          const parentId = node.parent;
          nodes
            .filter((n) => n.parent == nodeId)
            .forEach((child) => {
              child.parent = parentId;
              saveNode(child);
            });
          nodes = nodes.filter((n) => n.id != nodeId);
          deleteNodeDB(nodeId);
          hideGroupTooltip();
          renderNodes();
          drawConnections();
          hideAllMenus();
        }
        if (action === "toggle-done") {
          setNodeDoneStatus(node, !node.done);
          hideGroupTooltip();
          renderNodes();
          autoArrange();
          hideAllMenus();
        }
        if (action === "comments") {
          currentNoteNodeId = nodeId;
          showNotesMenu(x, y, node);
          dom.elementMenu.classList.add("hidden");
        }
      }
    });
  });

/** Event listener for back button in notes menu. */
document.getElementById("back-from-notes").addEventListener("click", (e) => {
  e.stopPropagation();
  const x = parseInt(dom.notesMenu.style.left);
  const y = parseInt(dom.notesMenu.style.top);
  dom.notesMenu.classList.add("hidden");
  if (activeEl) {
    positionFloating(dom.elementMenu, x, y);
  }
});

/**
 * Computes chains of completed tasks to be grouped.
 * @returns {Node[][]}
 */
function computeGroups() {
  const groups = [];
  const visited = new Set();

  nodes.forEach((node) => {
    if (node.type === "task" && node.done && !visited.has(node.id)) {
      let start = node;
      while (start.parent) {
        const parent = nodes.find((n) => n.id == start.parent);
        if (parent && parent.type === "task" && parent.done) {
          const siblings = nodes.filter((n) => n.parent == parent.id);
          if (siblings.length === 1) start = parent;
          else break;
        } else break;
      }

      const chain = [];
      let current = start;
      while (current && current.type === "task" && current.done) {
        const children = nodes.filter((n) => n.parent == current.id);
        if (
          children.length === 1 &&
          children[0].type === "task" &&
          children[0].done
        ) {
          chain.push(current);
          visited.add(current.id);
          current = children[0];
        } else {
          chain.push(current);
          visited.add(current.id);
          break;
        }
      }

      if (chain.length >= 2) groups.push(chain);
    }
  });
  return groups;
}

/**
 * Displays the group tooltip showing all tasks inside the group.
 * @param {Group} group - The group to display.
 * @returns {void}
 */
function showGroupTooltip(group) {
  dom.groupTooltip.innerHTML = "";

  const startDot = document.createElement("div");
  startDot.className = "green-dot";
  dom.groupTooltip.appendChild(startDot);

  group.nodes.forEach((node, index) => {
    const dash = document.createElement("div");
    dash.className = "dash-line";
    dom.groupTooltip.appendChild(dash);

    const nodeEl = document.createElement("div");
    nodeEl.className = `node task done`;
    nodeEl.dataset.id = node.id;

    const label = document.createElement("div");
    label.className = "task-label";
    label.innerText = node.title;
    nodeEl.appendChild(label);

    nodeEl.addEventListener("mouseenter", (e) => {
      if (
        !dom.elementMenu.classList.contains("hidden") ||
        !dom.contextMenu.classList.contains("hidden") ||
        !dom.notesMenu.classList.contains("hidden") ||
        !dom.noteModal.classList.contains("hidden") ||
        !dom.confirmModal.classList.contains("hidden")
      )
        return;
      const hasDesc = node.note && node.note.trim() !== "";
      const notes = node.notes || [];
      const hasNotes = notes.length > 0;
      if (!hasDesc && !hasNotes) return;
      let html = `<h4>${node.title}</h4>`;
      if (hasDesc) html += `<p>${node.note}</p>`;
      if (hasNotes) {
        html += '<div style="margin-top:5px;"></div>';
        notes.forEach((n) => {
          html += `<div class="comment-item"><div class="note-meta">${n.date} - ${n.time}</div>${n.text}</div>`;
        });
      }
      dom.hoverBox.innerHTML = html;
      positionHoverBox(e.clientX, e.clientY);
      dom.hoverBox.classList.remove("hidden");
    });
    nodeEl.addEventListener("mousemove", (e) => {
      positionHoverBox(e.clientX, e.clientY);
    });
    nodeEl.addEventListener("mouseleave", () =>
      dom.hoverBox.classList.add("hidden"),
    );

    dom.groupTooltip.appendChild(nodeEl);
  });

  const endDash = document.createElement("div");
  endDash.className = "dash-line";
  dom.groupTooltip.appendChild(endDash);

  const endDot = document.createElement("div");
  endDot.className = "green-dot";
  dom.groupTooltip.appendChild(endDot);

  const groupEl = dom.canvas.querySelector(
    `.node[data-id="group_${group.nodes[0].id}"]`,
  );
  if (groupEl) {
    positionGroupTooltip(dom.groupTooltip, groupEl.getBoundingClientRect());
  } else {
    dom.groupTooltip.classList.remove("hidden");
  }
}

/**
 * Sets the done status of a node and updates its parents/children accordingly.
 * @param {Node} node - The node to update.
 * @param {boolean} doneStatus - The new done status.
 * @returns {void}
 */
function setNodeDoneStatus(node, doneStatus) {
  if (node.type !== "task") return;
  if (doneStatus) {
    node.done = true;
    saveNode(node);
    let current = node;
    while (current.parent) {
      let parent = nodes.find((n) => n.id == current.parent);
      if (parent && parent.type === "task" && !parent.done) {
        parent.done = true;
        saveNode(parent);
      }
      current = parent;
    }
  } else {
    node.done = false;
    saveNode(node);
    const children = nodes.filter((n) => n.parent == node.id);
    children.forEach((child) => {
      child.parent = node.parent;
      saveNode(child);
    });
  }
}

/**
 * Shows the input modal for creating/editing nodes.
 * @param {'header'|'task'} type - The type of node.
 * @param {number} x - X coordinate for modal.
 * @param {number} y - Y coordinate for modal.
 * @param {Node} [node] - The node being edited, if any.
 * @returns {void}
 */
function showInputModal(type, x, y, node = null) {
  editingNodeId = node ? node.id : null;
  dom.inputTitle.value = node ? node.title : "";
  dom.inputNote.value = node ? node.note : "";
  dom.inputNote.style.display = type === "task" ? "block" : "none";
  dom.inputModal.dataset.type = type;
  dom.inputModal.dataset.x = x;
  dom.inputModal.dataset.y = y;
  positionFloating(dom.inputModal, x, y);
  dom.inputTitle.focus();
}

/** Event listener for saving node from input modal. */
document.getElementById("btn-save").addEventListener("click", () => {
  const title = dom.inputTitle.value.trim();
  const note = dom.inputNote.value.trim();
  const type = dom.inputModal.dataset.type;
  const x = parseInt(dom.inputModal.dataset.x);
  const y = parseInt(dom.inputModal.dataset.y);
  if (!title) return;

  const wasEditingId = editingNodeId;

  if (editingNodeId) {
    let node = nodes.find((n) => n.id == editingNodeId);
    node.title = title;
    if (node.type === "task") node.note = note;
    saveNode(node);
  } else {
    const rect = dom.canvas.getBoundingClientRect();
    const newNode = {
      id: crypto.randomUUID(),
      type,
      title,
      note,
      done: false,
      parent: null,
      notes: [],
      x: x - rect.left,
      y: y - rect.top + 40,
    };
    nodes.push(newNode);
    saveNode(newNode);
    dom.emptyState.style.display = "none";
  }
  hideAllModals();
  renderNodes();
  drawConnections();

  if (wasEditingId && !dom.groupTooltip.classList.contains("hidden")) {
    const group = Object.values(groupMap).find((g) =>
      g.nodes.some((n) => n.id == wasEditingId),
    );
    if (group) showGroupTooltip(group);
    else hideGroupTooltip();
  }
});

/**
 * Shows the notes menu for a node.
 * @param {number} x - X coordinate.
 * @param {number} y - Y coordinate.
 * @param {Node} node - The node.
 * @returns {void}
 */
function showNotesMenu(x, y, node) {
  positionFloating(dom.notesMenu, x, y);
  renderNotesList(node);
}

/**
 * Renders the list of notes in the notes menu.
 * @param {Node} node - The node whose notes are being rendered.
 * @returns {void}
 */
function renderNotesList(node) {
  dom.notesList.innerHTML = "";
  if (node.notes && node.notes.length > 0) {
    node.notes.forEach((n, index) => {
      const item = document.createElement("div");
      item.className = "note-list-item";
      const textContainer = document.createElement("div");
      textContainer.className = "note-text-container";
      let displayText =
        n.text.length > 15 ? n.text.substring(0, 15) + "..." : n.text;
      textContainer.innerHTML = `<div class="note-meta">${n.date} - ${n.time}</div><div class="note-text-preview">${displayText}</div>`;
      const actions = document.createElement("div");
      actions.className = "note-actions";
      const editBtn = document.createElement("button");
      editBtn.className = "note-action-btn";
      editBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openNoteModal(true, index, n.text);
      });
      const delBtn = document.createElement("button");
      delBtn.className = "note-action-btn delete-btn";
      delBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const x = parseInt(dom.notesMenu.style.left);
        const y = parseInt(dom.notesMenu.style.top);
        dom.notesMenu.classList.add("hidden");
        pendingDeleteAction = () => {
          node.notes.splice(index, 1);
          saveNode(node);
          dom.confirmModal.classList.add("hidden");
          showNotesMenu(x, y, node);
          renderNodes();
        };
        positionFloating(dom.confirmModal, x, y);
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      item.appendChild(textContainer);
      item.appendChild(actions);
      dom.notesList.appendChild(item);
    });
  }
}

/** Event listener for adding a new note. */
document
  .getElementById("add-note-btn")
  .addEventListener("click", () => openNoteModal(false, -1, ""));

/**
 * Opens the note modal for adding/editing a note.
 * @param {boolean} isEditing - Whether it's editing an existing note.
 * @param {number} index - The index of the note being edited.
 * @param {string} text - The text of the note.
 * @returns {void}
 */
function openNoteModal(isEditing, index, text) {
  editingNoteIndex = index;
  dom.noteTextInput.value = text;
  const x = parseInt(dom.notesMenu.style.left);
  const y = parseInt(dom.notesMenu.style.top);
  dom.notesMenu.classList.add("hidden");
  positionFloating(dom.noteModal, x, y);
  dom.noteTextInput.focus();
}

/** Event listener for saving a note. */
document.getElementById("save-note-btn").addEventListener("click", () => {
  const text = dom.noteTextInput.value.trim();
  if (!text || !currentNoteNodeId) return;
  const node = nodes.find((n) => n.id == currentNoteNodeId);
  if (!node.notes) node.notes = [];
  if (editingNoteIndex >= 0) node.notes[editingNoteIndex].text = text;
  else
    node.notes.push({
      text: text,
      date: getShamsiDate(),
      time: getCurrentTime(),
    });
  saveNode(node);
  dom.noteTextInput.value = "";
  dom.noteModal.classList.add("hidden");
  const x = parseInt(dom.noteModal.style.left);
  const y = parseInt(dom.noteModal.style.top);
  showNotesMenu(x, y, node);
  renderNodes();
});

/** Event listener for confirming note deletion. */
document.getElementById("confirm-yes").addEventListener("click", () => {
  if (pendingDeleteAction) pendingDeleteAction();
});
/** Event listener for canceling note deletion. */
document.getElementById("confirm-no").addEventListener("click", () => {
  dom.confirmModal.classList.add("hidden");
  pendingDeleteAction = null;
  if (currentNoteNodeId) {
    const node = nodes.find((n) => n.id == currentNoteNodeId);
    const x = parseInt(dom.confirmModal.style.left);
    const y = parseInt(dom.confirmModal.style.top);
    if (node) showNotesMenu(x, y, node);
  }
});

/**
 * Main render function for all nodes and groups on the canvas.
 * @returns {void}
 */
function renderNodes() {
  dom.canvas.querySelectorAll(".node").forEach((el) => el.remove());

  groups = computeGroups();
  groupedIds = new Set();
  groupMap = {};

  groups.forEach((chain) => {
    const firstNode = chain[0];
    const lastNode = chain[chain.length - 1];
    const groupNode = {
      id: "group_" + firstNode.id,
      type: "group",
      count: chain.length,
      nodes: chain,
      x: firstNode.x,
      y: firstNode.y,
      parent: firstNode.parent,
    };
    groupMap[firstNode.id] = groupNode;
    chain.forEach((n) => groupedIds.add(n.id));

    const el = document.createElement("div");
    el.className = `node task done group-node`;
    el.dataset.id = groupNode.id;
    el.dataset.groupId = firstNode.id;
    el.style.left = `${groupNode.x}px`;
    el.style.top = `${groupNode.y}px`;

    const label = document.createElement("div");
    label.className = "task-label";
    label.innerText = `${chain.length.toLocaleString("fa-IR")} وظیفه‌ی انجام‌شده`;
    el.appendChild(label);

    const icon = document.createElement("div");
    icon.className = "group-icon";
    icon.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    el.appendChild(icon);

    const cpLeft = document.createElement("div");
    cpLeft.className = "connection-point cp-left";
    el.appendChild(cpLeft);
    const cpRight = document.createElement("div");
    cpRight.className = "connection-point cp-right";
    el.appendChild(cpRight);

    el.addEventListener("mousedown", handleNodeMouseDown);
    cpLeft.addEventListener("mousedown", (e) =>
      handlePortMouseDown(e, lastNode, "left"),
    );
    cpRight.addEventListener("mousedown", (e) =>
      handlePortMouseDown(e, firstNode, "right"),
    );

    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("connection-point")) return;
      showGroupTooltip(groupNode);
    });

    dom.canvas.appendChild(el);
  });

  nodes.forEach((node) => {
    if (groupedIds.has(node.id)) return;

    const el = document.createElement("div");
    el.className = `node ${node.type}`;
    el.dataset.id = node.id;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    if (node.parent) el.classList.add("has-parent");

    if (node.type === "header") {
      el.innerText = node.title;
    } else {
      if (node.done) el.classList.add("done");
      const label = document.createElement("div");
      label.className = "task-label";
      label.innerText = node.title;
      el.appendChild(label);

      el.addEventListener("mouseenter", (e) => {
        if (
          !dom.elementMenu.classList.contains("hidden") ||
          !dom.contextMenu.classList.contains("hidden") ||
          !dom.notesMenu.classList.contains("hidden") ||
          !dom.noteModal.classList.contains("hidden") ||
          !dom.confirmModal.classList.contains("hidden") ||
          !dom.groupTooltip.classList.contains("hidden")
        )
          return;
        const hasDesc = node.note && node.note.trim() !== "";
        const notes = node.notes || [];
        const hasNotes = notes.length > 0;
        if (!hasDesc && !hasNotes) return;
        let html = `<h4>${node.title}</h4>`;
        if (hasDesc) html += `<p>${node.note}</p>`;
        if (hasNotes) {
          html += '<div style="margin-top:5px;"></div>';
          notes.forEach((n) => {
            html += `<div class="comment-item"><div class="note-meta">${n.date} - ${n.time}</div>${n.text}</div>`;
          });
        }
        dom.hoverBox.innerHTML = html;
        positionHoverBox(e.clientX, e.clientY);
        dom.hoverBox.classList.remove("hidden");
      });
      el.addEventListener("mousemove", (e) => {
        positionHoverBox(e.clientX, e.clientY);
      });
      el.addEventListener("mouseleave", () =>
        dom.hoverBox.classList.add("hidden"),
      );
    }

    const cpLeft = document.createElement("div");
    cpLeft.className = "connection-point cp-left";
    el.appendChild(cpLeft);
    const cpRight = document.createElement("div");
    cpRight.className = "connection-point cp-right";
    el.appendChild(cpRight);

    el.addEventListener("mousedown", handleNodeMouseDown);
    cpLeft.addEventListener("mousedown", (e) =>
      handlePortMouseDown(e, node, "left"),
    );
    cpRight.addEventListener("mousedown", (e) =>
      handlePortMouseDown(e, node, "right"),
    );

    dom.canvas.appendChild(el);
  });
}

/**
 * Handles mousedown event for dragging nodes.
 * @param {MouseEvent} e - The mouse event.
 * @returns {void}
 */
function handleNodeMouseDown(e) {
  if (e.button !== 0 || currentMode !== "move") return;
  if (e.target.classList.contains("connection-point")) return;

  const nodeEl = e.target.closest(".node");
  dragData = {
    type: "move-node",
    el: nodeEl,
    startX: e.clientX,
    startY: e.clientY,
    initX: parseInt(nodeEl.style.left),
    initY: parseInt(nodeEl.style.top),
    moved: false,
  };
  document.addEventListener("mousemove", handleDrag);
  document.addEventListener("mouseup", handleDragEnd);
}

/**
 * Handles mousedown event for connection points.
 * @param {MouseEvent} e - The mouse event.
 * @param {Node} node - The node owning the port.
 * @param {'left'|'right'} portType - The port type.
 * @returns {void}
 */
function handlePortMouseDown(e, node, portType) {
  if (e.button !== 0 || currentMode !== "move") return;
  e.stopPropagation();
  if (portType === "left") {
    dragData = { type: "new-connection", sourceNode: node };
  } else {
    if (!node.parent) return;
    const sourceNode = nodes.find((n) => n.id == node.parent);
    dragData = {
      type: "move-connection",
      sourceNode: sourceNode,
      targetNode: node,
    };
  }
  document.addEventListener("mousemove", handleDrag);
  document.addEventListener("mouseup", handleDragEnd);
}

/**
 * Handles mousemove event during dragging.
 * @param {MouseEvent} e - The mouse event.
 * @returns {void}
 */
function handleDrag(e) {
  if (!dragData) return;
  if (dragData.type === "move-node") {
    const dx = e.clientX - dragData.startX;
    const dy = e.clientY - dragData.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragData.moved = true;
    if (dragData.el) {
      dragData.el.style.left = `${dragData.initX + dx}px`;
      dragData.el.style.top = `${dragData.initY + dy}px`;
    }
    requestDraw();
  } else {
    if (!dragData.tempLine) {
      if (dragData.type === "move-connection") drawConnections();
      dragData.tempLine = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      dragData.tempLine.setAttribute("stroke-width", "2");
      dragData.tempLine.setAttribute("stroke-dasharray", "5,5");
      dragData.tempLine.setAttribute("fill", "none");
      dom.svgLayer.appendChild(dragData.tempLine);
    }
    const targetEl = e.target.closest(".node");
    let isConnectable = false;
    if (targetEl) {
      let targetId = targetEl.dataset.id;
      if (targetId.startsWith("group_")) targetId = targetEl.dataset.groupId;
      const targetNode = nodes.find((n) => n.id == targetId);
      if (
        targetNode &&
        targetNode.id !== dragData.sourceNode.id &&
        !isAncestor(targetNode.id, dragData.sourceNode.id) &&
        !isAncestor(dragData.sourceNode.id, targetNode.id)
      )
        isConnectable = true;
    }
    dragData.tempLine.setAttribute(
      "stroke",
      isConnectable
        ? "#007bff"
        : dragData.type === "new-connection"
          ? "#ccc"
          : "#ff0000",
    );
    const canvasRect = dom.canvas.getBoundingClientRect();
    const sourceEl = getRenderedEl(dragData.sourceNode.id);
    if (!sourceEl) return;
    const cp = sourceEl.querySelector(".cp-left");
    const cpRect = cp.getBoundingClientRect();
    const x1 = cpRect.left - canvasRect.left + 4;
    const y1 = cpRect.top - canvasRect.top + 4;
    const x2 = e.clientX - canvasRect.left;
    const y2 = e.clientY - canvasRect.top;
    const midX = (x1 + x2) / 2;
    dragData.tempLine.setAttribute(
      "d",
      `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
    );
  }
}

/**
 * Pushes a node (or its group) down by a specified amount to resolve overlaps.
 * @param {Node} movedNode - The node being pushed.
 * @param {number} amount - The amount to push down.
 * @returns {void}
 */
function applyPush(movedNode, amount) {
  if (groupedIds.has(movedNode.id) && groupMap[movedNode.id]) {
    const grp = groupMap[movedNode.id];
    grp.y += amount;
    grp.nodes.forEach((n) => {
      n.y += amount;
      saveNode(n);
    });
  } else {
    movedNode.y += amount;
    saveNode(movedNode);
  }
}

/**
 * Resolves overlaps between a moved node and other nodes/connections.
 * @param {Node} movedNode - The node that was moved.
 * @returns {void}
 */
function resolveOverlaps(movedNode) {
  groups = computeGroups();
  groupedIds = new Set();
  groupMap = {};
  groups.forEach((chain) => {
    groupMap[chain[0].id] = {
      id: "group_" + chain[0].id,
      nodes: chain,
      x: chain[0].x,
      y: chain[0].y,
    };
    chain.forEach((n) => groupedIds.add(n.id));
  });

  let changed = true;
  let iterations = 0;
  let finalY = movedNode.y;

  while (changed && iterations < 5) {
    changed = false;
    iterations++;

    const visualNode = getVisualNode(movedNode.id);
    if (!visualNode) break;
    const movedEl = getRenderedEl(visualNode.id);
    if (!movedEl) break;

    const mW = movedEl.offsetWidth;
    const mH = movedEl.offsetHeight;
    const mX1 = visualNode.x;
    const mY1 = finalY;
    const mX2 = mX1 + mW;
    const mY2 = mY1 + mH;
    let needsPush = false;

    for (let other of nodes) {
      if (other.id === movedNode.id) continue;
      if (groupedIds.has(other.id) && !groupMap[other.id]) continue;

      const otherVisual = getVisualNode(other.id);
      if (!otherVisual || otherVisual.id === visualNode.id) continue;

      const otherEl = getRenderedEl(otherVisual.id);
      if (!otherEl) continue;
      const oW = otherEl.offsetWidth;
      const oH = otherEl.offsetHeight;
      const oX1 = otherVisual.x;
      const oY1 = otherVisual.y;
      const oX2 = oX1 + oW;
      const oY2 = oY1 + oH;

      if (mX1 < oX2 && mX2 > oX1 && mY1 < oY2 && mY2 > oY1) {
        needsPush = true;
        break;
      }
    }

    if (needsPush) {
      finalY += 100;
      changed = true;
      continue;
    }

    for (let node of nodes) {
      if (!node.parent) continue;
      if (node.id === movedNode.id) continue;
      if (groupedIds.has(node.id) && !groupMap[node.id]) continue;

      const parent = getVisualNode(node.parent);
      if (!parent || parent.id === visualNode.id) continue;

      const parentEl = getRenderedEl(parent.id);
      const childEl = getRenderedEl(node.id);
      if (!parentEl || !childEl) continue;
      const parentH = parentEl.offsetHeight;
      const childH = childEl.offsetHeight;
      const childW = childEl.offsetWidth;
      const pX = parent.x;
      const pY = parent.y + parentH / 2;
      const cX = node.x + childW;
      const cY = node.y + childH / 2;
      const midX = (pX + cX) / 2;

      let minY = Infinity;
      let maxY = -Infinity;
      let intersectsX = false;
      for (let t = 0; t <= 1; t += 0.05) {
        const u = 1 - t;
        const x =
          u * u * u * pX +
          3 * u * u * t * midX +
          3 * u * t * t * midX +
          t * t * t * cX;
        const y =
          u * u * u * pY +
          3 * u * u * t * pY +
          3 * u * t * t * cY +
          t * t * t * cY;
        if (x >= mX1 && x <= mX2) {
          intersectsX = true;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (intersectsX && maxY >= mY1 && minY <= mY2) {
        needsPush = true;
        break;
      }
    }

    if (needsPush) {
      finalY += 100;
      changed = true;
    }
  }

  const dy = finalY - movedNode.y;
  if (dy !== 0) {
    applyPush(movedNode, dy);
  }

  renderNodes();
  const newVisualNode = getVisualNode(movedNode.id);
  if (newVisualNode) {
    const newEl = getRenderedEl(newVisualNode.id);
    if (newEl) {
      const oldY = newVisualNode.y - dy;
      newEl.style.top = `${oldY}px`;
      void newEl.offsetHeight;
      newEl.classList.add("smooth-arrange");
      newEl.style.top = `${newVisualNode.y}px`;

      const start = performance.now();
      function animateLines(now) {
        drawConnections();
        if (now - start < 350) requestAnimationFrame(animateLines);
      }
      requestAnimationFrame(animateLines);
      setTimeout(() => newEl.classList.remove("smooth-arrange"), 350);
    }
  }
}

/**
 * Handles mouseup event to finalize dragging.
 * @param {MouseEvent} e - The mouse event.
 * @returns {void}
 */
function handleDragEnd(e) {
  if (!dragData) return;
  try {
    if (dragData.type === "move-node") {
      if (dragData.moved) {
        const id = dragData.el.dataset.id;
        const groupId = dragData.el.dataset.groupId;
        const newX = parseInt(dragData.el.style.left);
        const newY = parseInt(dragData.el.style.top);

        if (groupId) {
          const groupChain = groups.find(
            (chain) => "group_" + chain[0].id === id,
          );
          if (groupChain) {
            const dx = newX - groupChain[0].x;
            const dy = newY - groupChain[0].y;
            groupChain.forEach((n) => {
              n.x += dx;
              n.y += dy;
              saveNode(n);
            });

            const grp = groupMap[groupChain[0].id];
            if (grp) {
              grp.x = groupChain[0].x;
              grp.y = groupChain[0].y;
            }
            resolveOverlaps(groupChain[0]);
          }
        } else {
          let node = nodes.find((n) => n.id == id);
          if (node) {
            node.x = newX;
            node.y = newY;
            saveNode(node);
            resolveOverlaps(node);
          }
        }
      }
    } else if (dragData.tempLine) {
      dragData.tempLine.remove();
      const targetEl = e.target.closest(".node");
      if (targetEl) {
        let targetId = targetEl.dataset.id;
        if (targetId.startsWith("group_")) targetId = targetEl.dataset.groupId;
        const targetNode = nodes.find((n) => n.id == targetId);
        if (
          targetNode &&
          targetNode.id !== dragData.sourceNode.id &&
          !isAncestor(targetNode.id, dragData.sourceNode.id) &&
          !isAncestor(dragData.sourceNode.id, targetNode.id)
        ) {
          if (dragData.type === "move-connection") {
            dragData.targetNode.parent = null;
            saveNode(dragData.targetNode);
          }
          targetNode.parent = dragData.sourceNode.id;
          saveNode(targetNode);
          if (dragData.sourceNode.type === "task")
            setNodeDoneStatus(dragData.sourceNode, true);
        }
      } else {
        if (dragData.type === "move-connection") {
          dragData.targetNode.parent = null;
          saveNode(dragData.targetNode);
        }
      }
      renderNodes();
    }
    drawConnections();
  } catch (err) {
    console.error("Error during drag end:", err);
  } finally {
    dragData = null;
    document.removeEventListener("mousemove", handleDrag);
    document.removeEventListener("mouseup", handleDragEnd);
  }
}

/**
 * Checks if a node is an ancestor of another node.
 * @param {string} potentialAncestorId - The potential ancestor ID.
 * @param {string} nodeId - The node ID to check.
 * @returns {boolean}
 */
function isAncestor(potentialAncestorId, nodeId) {
  let current = nodes.find((n) => n.id == nodeId);
  while (current && current.parent) {
    if (current.parent === potentialAncestorId) return true;
    current = nodes.find((n) => n.id == current.parent);
  }
  return false;
}

/** Throttles drawing of connections using requestAnimationFrame. @returns {void} */
function requestDraw() {
  if (!isDrawing) {
    isDrawing = true;
    requestAnimationFrame(() => {
      drawConnections();
      isDrawing = false;
    });
  }
}

/** Draws all connection lines between nodes on the SVG layer. @returns {void} */
function drawConnections() {
  dom.svgLayer.innerHTML = "";
  const canvasRect = dom.canvas.getBoundingClientRect();
  nodes.forEach((node) => {
    if (node.parent) {
      if (
        dragData &&
        dragData.type === "move-connection" &&
        dragData.targetNode.id === node.id
      )
        return;

      const parent = getVisualNode(node.parent);
      if (!parent) return;

      const parentGroup = Object.values(groupMap).find((g) =>
        g.nodes.some((n) => n.id == node.parent),
      );
      const childGroup = Object.values(groupMap).find((g) =>
        g.nodes.some((n) => n.id == node.id),
      );
      if (parentGroup && childGroup === parentGroup) return;

      const parentEl = getRenderedEl(parent.id);
      const childEl = getRenderedEl(node.id);
      if (!parentEl || !childEl) return;
      const pCp = parentEl.querySelector(".cp-left");
      const cCp = childEl.querySelector(".cp-right");
      if (!pCp || !cCp) return;
      const pRect = pCp.getBoundingClientRect();
      const cRect = cCp.getBoundingClientRect();
      const x1 = pRect.left - canvasRect.left + 4;
      const y1 = pRect.top - canvasRect.top + 4;
      const x2 = cRect.left - canvasRect.left + 4;
      const y2 = cRect.top - canvasRect.top + 4;
      const midX = (x1 + x2) / 2;
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("class", "connection-line");
      path.setAttribute(
        "d",
        `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
      );
      dom.svgLayer.appendChild(path);
    }
  });
}

/**
 * Automatically arranges all nodes smoothly on the canvas.
 * Also pans the canvas into view if the content is outside the viewport.
 * @returns {void}
 */
function autoArrange() {
  groups = computeGroups();
  groupedIds = new Set();
  groupMap = {};
  groups.forEach((chain) => {
    groupMap[chain[0].id] = {
      id: "group_" + chain[0].id,
      nodes: chain,
      x: chain[0].x,
      y: chain[0].y,
    };
    chain.forEach((n) => groupedIds.add(n.id));
  });

  renderNodes();

  const oldPos = {};
  nodes.forEach((n) => (oldPos[n.id] = { x: n.x, y: n.y }));

  const roots = nodes.filter(
    (n) => !n.parent && !(groupedIds.has(n.id) && !groupMap[n.id]),
  );
  if (roots.length === 0) return;

  let currentY = 50;
  roots.forEach((root) => {
    const bounds = layoutTree(root, 300, currentY);
    currentY = bounds.maxY + 25.7;
  });

  nodes.forEach((node) => saveNode(node));

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  nodes.forEach((node) => {
    if (groupedIds.has(node.id) && !groupMap[node.id]) return;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    const el = getRenderedEl(node.id);
    const w = el ? el.offsetWidth : FALLBACK_WIDTH;
    const h = el ? el.offsetHeight : FALLBACK_HEIGHT;
    maxX = Math.max(maxX, node.x + w);
    maxY = Math.max(maxY, node.y + h);
  });

  const cLeft = parseInt(dom.canvas.style.left || 0);
  const cTop = parseInt(dom.canvas.style.top || 0);

  const isFullyOutside = !(
    cLeft + maxX > 0 &&
    cLeft + minX < window.innerWidth &&
    cTop + maxY > 0 &&
    cTop + minY < window.innerHeight
  );

  let canvasPanned = false;
  if (isFullyOutside && !isNaN(minX)) {
    const targetScreenX = window.innerWidth * 0.75;
    const targetScreenY = window.innerHeight * 0.35;

    const newCanvasLeft = targetScreenX - maxX;
    const newCanvasTop = targetScreenY - minY;

    dom.canvas.style.transition = "left 0.3s ease, top 0.3s ease";
    dom.canvas.style.left = `${newCanvasLeft}px`;
    dom.canvas.style.top = `${newCanvasTop}px`;

    localStorage.setItem("canvasX", newCanvasLeft);
    localStorage.setItem("canvasY", newCanvasTop);
    canvasPanned = true;
  }

  nodes.forEach((node) => {
    if (groupedIds.has(node.id) && !groupMap[node.id]) return;
    const el = getRenderedEl(node.id);
    if (el) {
      el.style.left = `${oldPos[node.id].x}px`;
      el.style.top = `${oldPos[node.id].y}px`;
    }
  });

  dom.canvas.offsetWidth;

  nodes.forEach((node) => {
    if (groupedIds.has(node.id) && !groupMap[node.id]) return;
    const el = getRenderedEl(node.id);
    if (el) {
      el.classList.add("smooth-arrange");
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
    }
  });

  const start = performance.now();
  function animateLoop(now) {
    drawConnections();
    if (now - start < 350) requestAnimationFrame(animateLoop);
    else {
      nodes.forEach((node) => {
        if (groupedIds.has(node.id) && !groupMap[node.id]) return;
        const el = getRenderedEl(node.id);
        if (el) el.classList.remove("smooth-arrange");
      });
      if (canvasPanned) {
        dom.canvas.style.transition = "";
      }
    }
  }
  requestAnimationFrame(animateLoop);
}

/** Horizontal gap between parent and child nodes. */
const GAP = 70;
/** Vertical gap between sibling nodes. */
const VERTICAL_GAP = 25;
/** Fallback height for nodes if DOM measurement fails. */
const FALLBACK_HEIGHT = 40;
/** Fallback width for nodes if DOM measurement fails. */
const FALLBACK_WIDTH = 150;

/**
 * Recursive algorithm to layout tree nodes based on visual bounds.
 * @param {Node} node - The current node.
 * @param {number} x - The X coordinate.
 * @param {number} y - The Y coordinate.
 * @returns {{minY: number, maxY: number}}
 */
function layoutTree(node, x, y) {
  const el = getRenderedEl(node.id);
  const h = el ? el.offsetHeight : FALLBACK_HEIGHT;

  node.x = x;
  const children = getLayoutChildren(node);

  if (children.length === 0) {
    node.y = y;
    if (groupMap[node.id]) {
      groupMap[node.id].x = node.x;
      groupMap[node.id].y = node.y;
      groupMap[node.id].nodes.forEach((n) => {
        n.x = x;
        n.y = y;
      });
    }
    return { minY: y, maxY: y + h };
  }

  let currentY = y;
  let totalMaxY = -Infinity;
  let firstChildH = FALLBACK_HEIGHT;

  children.forEach((child, idx) => {
    const childEl = getRenderedEl(child.id);
    const childW = childEl ? childEl.offsetWidth : FALLBACK_WIDTH;
    if (idx === 0)
      firstChildH = childEl ? childEl.offsetHeight : FALLBACK_HEIGHT;
    const childBounds = layoutTree(child, x - GAP - childW, currentY);
    currentY = childBounds.maxY + VERTICAL_GAP;
    totalMaxY = Math.max(totalMaxY, childBounds.maxY);
  });

  node.y = y + firstChildH / 2 - h / 2;

  if (groupMap[node.id]) {
    groupMap[node.id].x = node.x;
    groupMap[node.id].y = node.y;
    groupMap[node.id].nodes.forEach((n) => {
      n.x = node.x;
      n.y = node.y;
    });
  }

  return {
    minY: Math.min(node.y, y),
    maxY: Math.max(node.y + h, totalMaxY),
  };
}

/** @type {{startX: number, startY: number, initLeft: number, initTop: number} | null} */
let panData = null;

/** Event listener for canvas panning. */
document.getElementById("canvas-wrapper").addEventListener("mousedown", (e) => {
  if (currentMode === "pan") {
    panData = {
      startX: e.clientX,
      startY: e.clientY,
      initLeft: parseInt(dom.canvas.style.left || 0),
      initTop: parseInt(dom.canvas.style.top || 0),
    };
    document.addEventListener("mousemove", handlePan);
    document.addEventListener("mouseup", endPan);
  }
});

/**
 * Handles mousemove for canvas panning.
 * @param {MouseEvent} e - The mouse event.
 * @returns {void}
 */
function handlePan(e) {
  if (!panData) return;
  dom.canvas.style.left = `${panData.initLeft + (e.clientX - panData.startX)}px`;
  dom.canvas.style.top = `${panData.initTop + (e.clientY - panData.startY)}px`;
  requestDraw();
}

/** Ends canvas panning and saves coordinates. @returns {void} */
function endPan() {
  localStorage.setItem("canvasX", parseInt(dom.canvas.style.left) || 0);
  localStorage.setItem("canvasY", parseInt(dom.canvas.style.top) || 0);
  panData = null;
  document.removeEventListener("mousemove", handlePan);
  document.removeEventListener("mouseup", endPan);
}

/**
 * Positions floating elements (menus/modals) safely within viewport bounds.
 * @param {HTMLElement} el - The element to position.
 * @param {number} x - Target X coordinate.
 * @param {number} y - Target Y coordinate.
 * @returns {void}
 */
function positionFloating(el, x, y) {
  el.style.top = `${y}px`;
  el.style.left = `${x}px`;
  el.classList.remove("hidden");

  const rect = el.getBoundingClientRect();
  const margin = 10;
  let newTop = y;
  let newLeft = x;

  if (rect.bottom > window.innerHeight - margin) {
    newTop = y - rect.height;
  }
  if (rect.right > window.innerWidth - margin) {
    newLeft = x - rect.width;
  }
  if (newTop < margin) newTop = margin;
  if (newLeft < margin) newLeft = margin;

  el.style.top = `${newTop}px`;
  el.style.left = `${newLeft}px`;
}

/**
 * Positions the group tooltip safely within viewport bounds.
 * @param {HTMLElement} el - The tooltip element.
 * @param {DOMRect} anchorRect - The bounding rect of the anchor node.
 * @returns {void}
 */
function positionGroupTooltip(el, anchorRect) {
  const margin = 10;
  el.style.transform = "translateX(-50%)";
  el.style.left = `${anchorRect.left + anchorRect.width / 2}px`;
  el.style.top = `${anchorRect.bottom + 15}px`;
  el.classList.remove("hidden");

  const rect = el.getBoundingClientRect();
  let shiftX = 0;

  if (rect.right > window.innerWidth - margin) {
    shiftX = window.innerWidth - margin - rect.right;
  }
  if (rect.left < margin) {
    shiftX = margin - rect.left;
  }
  if (rect.bottom > window.innerHeight - margin) {
    el.style.top = `${anchorRect.top - rect.height - 15}px`;
  }

  if (shiftX !== 0) {
    el.style.left = `${anchorRect.left + anchorRect.width / 2 + shiftX}px`;
  }
}

/**
 * Positions the hover box safely within viewport bounds.
 * @param {number} clientX - Mouse X coordinate.
 * @param {number} clientY - Mouse Y coordinate.
 * @returns {void}
 */
function positionHoverBox(clientX, clientY) {
  const margin = 10;
  dom.hoverBox.style.top = `${clientY + 15}px`;
  dom.hoverBox.style.left = `${clientX}px`;

  const rect = dom.hoverBox.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - margin) {
    dom.hoverBox.style.top = `${clientY - rect.height - 15}px`;
  }
  if (rect.right > window.innerWidth - margin) {
    dom.hoverBox.style.left = `${clientX - rect.width}px`;
  }
}

initDB();
