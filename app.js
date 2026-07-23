// --- کش کردن المان‌های DOM ---
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
};

// --- متغیرهای سراسری ---
let db;
let nodes = [];
let currentMode = "pan";
let activeEl = null;
let dragData = null;
let isDrawing = false;

let editingNodeId = null;
let currentNoteNodeId = null;
let editingNoteIndex = -1;
let pendingDeleteAction = null;

// --- تنظیمات پایگاه داده ---
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

function loadNodes() {
  const tx = db.transaction("nodes", "readonly");
  const store = tx.objectStore("nodes");
  store.getAll().onsuccess = (e) => {
    nodes = e.target.result || [];

    nodes.forEach((node) => {
      if (
        node.comments &&
        node.comments.length > 0 &&
        (!node.notes || node.notes.length === 0)
      ) {
        node.notes = node.comments.map((c) => ({
          text: c,
          date: "نامشخص",
          time: "",
        }));
        delete node.comments;
        saveNode(node);
      }
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

function saveNode(node) {
  const tx = db.transaction("nodes", "readwrite");
  tx.objectStore("nodes").put(node);
}

function deleteNodeDB(id) {
  const tx = db.transaction("nodes", "readwrite");
  tx.objectStore("nodes").delete(id);
}

// --- توابع کمکی ---
function getShamsiDate() {
  return new Date().toLocaleDateString("fa-IR", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getCurrentTime() {
  return new Date().toLocaleTimeString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function hideAllMenus() {
  dom.contextMenu.classList.add("hidden");
  dom.elementMenu.classList.add("hidden");
  dom.notesMenu.classList.add("hidden");
}

function hideAllModals() {
  dom.inputModal.classList.add("hidden");
  dom.noteModal.classList.add("hidden");
  dom.confirmModal.classList.add("hidden");
}

dom.dateDisplay.innerText = getShamsiDate();

// --- مدیریت ابزارها ---
dom.toolBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    dom.toolBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.id.split("-")[1];
    document.body.className = `mode-${currentMode}`;
  });
});

document.getElementById("tool-arrange").addEventListener("click", autoArrange);

// --- منوی راست کلیک ---
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  hideAllMenus();
  hideAllModals();

  const nodeEl = e.target.closest(".node");

  if (nodeEl) {
    activeEl = nodeEl;
    const nodeData = nodes.find((n) => n.id == nodeEl.dataset.id);
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

    dom.elementMenu.style.top = `${e.clientY}px`;
    dom.elementMenu.style.left = `${e.clientX}px`;
    dom.elementMenu.classList.remove("hidden");
  } else if (e.target.closest("#canvas-wrapper")) {
    activeEl = null;
    const taskItem = dom.contextMenu.querySelector('[data-action="new-task"]');
    taskItem.classList.toggle(
      "disabled",
      !nodes.some((n) => n.type === "header"),
    );

    dom.contextMenu.style.top = `${e.clientY}px`;
    dom.contextMenu.style.left = `${e.clientX}px`;
    dom.contextMenu.classList.remove("hidden");
  }
});

document.addEventListener("mousedown", (e) => {
  if (
    !e.target.closest(".context-menu") &&
    !e.target.closest(".modal-content")
  ) {
    hideAllMenus();
    hideAllModals();
    editingNodeId = null;
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
          renderNodes();
          drawConnections();
          hideAllMenus();
        }

        if (action === "toggle-done") {
          setNodeDoneStatus(node, !node.done);
          renderNodes();
          resolveOverlaps(node);
          drawConnections();
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

document.getElementById("back-from-notes").addEventListener("click", (e) => {
  e.stopPropagation();
  const x = parseInt(dom.notesMenu.style.left);
  const y = parseInt(dom.notesMenu.style.top);
  dom.notesMenu.classList.add("hidden");

  if (activeEl) {
    const nodeData = nodes.find((n) => n.id == activeEl.dataset.id);
    if (nodeData) {
      dom.elementMenu.style.top = `${y}px`;
      dom.elementMenu.style.left = `${x}px`;
      dom.elementMenu.classList.remove("hidden");
    }
  }
});

// --- منطق انجام‌شده/نشده زنجیره‌ای ---
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

// --- پنجره‌های ورودی ---
function showInputModal(type, x, y, node = null) {
  editingNodeId = node ? node.id : null;
  dom.inputTitle.value = node ? node.title : "";
  dom.inputNote.value = node ? node.note : "";
  dom.inputNote.style.display = type === "task" ? "block" : "none";

  dom.inputModal.dataset.type = type;
  dom.inputModal.dataset.x = x;
  dom.inputModal.dataset.y = y;

  dom.inputModal.style.top = `${y}px`;
  dom.inputModal.style.left = `${x}px`;
  dom.inputModal.classList.remove("hidden");
  dom.inputTitle.focus();
}

document.getElementById("btn-save").addEventListener("click", () => {
  const title = dom.inputTitle.value.trim();
  const note = dom.inputNote.value.trim();
  const type = dom.inputModal.dataset.type;
  const x = parseInt(dom.inputModal.dataset.x);
  const y = parseInt(dom.inputModal.dataset.y);

  if (!title) return;

  if (editingNodeId) {
    let node = nodes.find((n) => n.id == editingNodeId);
    node.title = title;
    if (node.type === "task") node.note = note;
    saveNode(node);
  } else {
    const rect = dom.canvas.getBoundingClientRect();
    const newNode = {
      id: Date.now().toString(),
      type: type,
      title: title,
      note: note,
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
});

// --- سیستم یادداشت‌ها ---
function showNotesMenu(x, y, node) {
  dom.notesMenu.style.top = `${y}px`;
  dom.notesMenu.style.left = `${x}px`;
  dom.notesMenu.classList.remove("hidden");
  renderNotesList(node);
}

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
      // تاریخ بالای متن قرار گرفت
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

        dom.confirmModal.style.top = `${y}px`;
        dom.confirmModal.style.left = `${x}px`;
        dom.confirmModal.classList.remove("hidden");
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      item.appendChild(textContainer);
      item.appendChild(actions);
      dom.notesList.appendChild(item);
    });
  }
}

document.getElementById("add-note-btn").addEventListener("click", () => {
  openNoteModal(false, -1, "");
});

function openNoteModal(isEditing, index, text) {
  editingNoteIndex = index;
  dom.noteTextInput.value = text;

  const x = parseInt(dom.notesMenu.style.left);
  const y = parseInt(dom.notesMenu.style.top);

  dom.notesMenu.classList.add("hidden");
  dom.noteModal.style.top = `${y}px`;
  dom.noteModal.style.left = `${x}px`;
  dom.noteModal.classList.remove("hidden");
  dom.noteTextInput.focus();
}

document.getElementById("save-note-btn").addEventListener("click", () => {
  const text = dom.noteTextInput.value.trim();
  if (!text || !currentNoteNodeId) return;

  const node = nodes.find((n) => n.id == currentNoteNodeId);
  if (!node.notes) node.notes = [];

  if (editingNoteIndex >= 0) {
    node.notes[editingNoteIndex].text = text;
  } else {
    node.notes.push({
      text: text,
      date: getShamsiDate(),
      time: getCurrentTime(),
    });
  }
  saveNode(node);

  dom.noteTextInput.value = "";
  dom.noteModal.classList.add("hidden");

  const x = parseInt(dom.noteModal.style.left);
  const y = parseInt(dom.noteModal.style.top);
  showNotesMenu(x, y, node);
  renderNodes();
});

document.getElementById("confirm-yes").addEventListener("click", () => {
  if (pendingDeleteAction) pendingDeleteAction();
});

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

// --- رندر کردن نودها ---
function renderNodes() {
  dom.canvas.querySelectorAll(".node").forEach((el) => el.remove());

  nodes.forEach((node) => {
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
        dom.hoverBox.style.top = `${e.clientY + 15}px`;
        dom.hoverBox.style.left = `${e.clientX}px`;
        dom.hoverBox.classList.remove("hidden");
      });

      el.addEventListener("mousemove", (e) => {
        dom.hoverBox.style.top = `${e.clientY + 15}px`;
        dom.hoverBox.style.left = `${e.clientX}px`;
      });

      el.addEventListener("mouseleave", () => {
        dom.hoverBox.classList.add("hidden");
      });
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

// --- مدیریت درگ المان‌ها و اتصالات ---
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
  };
  document.addEventListener("mousemove", handleDrag);
  document.addEventListener("mouseup", handleDragEnd);
}

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

function handleDrag(e) {
  if (!dragData) return;

  if (dragData.type === "move-node") {
    const dx = e.clientX - dragData.startX;
    const dy = e.clientY - dragData.startY;
    dragData.el.style.left = `${dragData.initX + dx}px`;
    dragData.el.style.top = `${dragData.initY + dy}px`;
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
      const targetNode = nodes.find((n) => n.id == targetEl.dataset.id);
      if (
        targetNode &&
        targetNode.id !== dragData.sourceNode.id &&
        !isAncestor(targetNode.id, dragData.sourceNode.id) &&
        !isAncestor(dragData.sourceNode.id, targetNode.id)
      ) {
        isConnectable = true;
      }
    }

    const strokeColor = isConnectable
      ? "#007bff"
      : dragData.type === "new-connection"
        ? "#ccc"
        : "#ff0000";
    dragData.tempLine.setAttribute("stroke", strokeColor);

    const canvasRect = dom.canvas.getBoundingClientRect();
    const sourceEl = dom.canvas.querySelector(
      `.node[data-id="${dragData.sourceNode.id}"]`,
    );
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

// تابع کمکی برای اعمال انیمیشن نرم و رسم همزمان خطوط
function applySmoothPosition(el, top, left = null) {
  el.classList.add("smooth-arrange");
  void el.offsetHeight;
  if (left !== null) el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const start = performance.now();
  function animateLines(now) {
    drawConnections();
    if (now - start < 350) {
      requestAnimationFrame(animateLines);
    }
  }
  requestAnimationFrame(animateLines);

  setTimeout(() => {
    el.classList.remove("smooth-arrange");
  }, 350);
}

// متد رفع تداخل (با فاصله ۱۰۰ پیکسل و تشخیص دقیق ریاضی خطوط)
function resolveOverlaps(movedNode) {
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 5) {
    changed = false;
    iterations++;

    const movedEl = dom.canvas.querySelector(
      `.node[data-id="${movedNode.id}"]`,
    );
    if (!movedEl) break;
    const mW = movedEl.offsetWidth;
    const mH = movedEl.offsetHeight;
    const mX1 = movedNode.x;
    const mY1 = movedNode.y;
    const mX2 = mX1 + mW;
    const mY2 = mY1 + mH;

    let needsPush = false;

    // ۱. بررسی تداخل المان‌ها با هم (محاسبه ریاضی)
    for (let other of nodes) {
      if (other.id === movedNode.id) continue;
      const otherEl = dom.canvas.querySelector(`.node[data-id="${other.id}"]`);
      if (!otherEl) continue;
      const oW = otherEl.offsetWidth;
      const oH = otherEl.offsetHeight;
      const oX1 = other.x;
      const oY1 = other.y;
      const oX2 = oX1 + oW;
      const oY2 = oY1 + oH;

      if (mX1 < oX2 && mX2 > oX1 && mY1 < oY2 && mY2 > oY1) {
        needsPush = true;
        break;
      }
    }

    if (needsPush) {
      movedNode.y += 100;
      changed = true;
      continue;
    }

    // ۲. بررسی تداخل با مسیر خطوط اتصال (محاسبه دقیق برخورد با منحنی)
    for (let node of nodes) {
      if (!node.parent) continue;
      if (node.id === movedNode.id || node.parent === movedNode.id) continue;

      const parent = nodes.find((n) => n.id == node.parent);
      if (!parent) continue;

      const parentEl = dom.canvas.querySelector(
        `.node[data-id="${parent.id}"]`,
      );
      const childEl = dom.canvas.querySelector(`.node[data-id="${node.id}"]`);
      if (!parentEl || !childEl) continue;

      const parentH = parentEl.offsetHeight;
      const childH = childEl.offsetHeight;
      const childW = childEl.offsetWidth;

      const pX = parent.x - 1;
      const pY = parent.y + parentH / 2;
      const cX = node.x + childW - 1;
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
      movedNode.y += 100;
      changed = true;
    }
  }

  const movedEl = dom.canvas.querySelector(`.node[data-id="${movedNode.id}"]`);
  if (movedEl) {
    applySmoothPosition(movedEl, movedNode.y);
    saveNode(movedNode);
  }
}

function handleDragEnd(e) {
  if (!dragData) return;

  if (dragData.type === "move-node") {
    const node = nodes.find((n) => n.id == dragData.el.dataset.id);
    node.x = parseInt(dragData.el.style.left);
    node.y = parseInt(dragData.el.style.top);
    saveNode(node);
    resolveOverlaps(node);
  } else if (dragData.tempLine) {
    dragData.tempLine.remove();

    const targetEl = e.target.closest(".node");
    if (targetEl) {
      const targetNode = nodes.find((n) => n.id == targetEl.dataset.id);
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

        if (dragData.sourceNode.type === "task") {
          setNodeDoneStatus(dragData.sourceNode, true);
        }
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

  dragData = null;
  document.removeEventListener("mousemove", handleDrag);
  document.removeEventListener("mouseup", handleDragEnd);
}

function isAncestor(potentialAncestorId, nodeId) {
  let current = nodes.find((n) => n.id == nodeId);
  while (current && current.parent) {
    if (current.parent === potentialAncestorId) return true;
    current = nodes.find((n) => n.id == current.parent);
  }
  return false;
}

function requestDraw() {
  if (!isDrawing) {
    isDrawing = true;
    requestAnimationFrame(() => {
      drawConnections();
      isDrawing = false;
    });
  }
}

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

      const parentEl = dom.canvas.querySelector(
        `.node[data-id="${node.parent}"]`,
      );
      const childEl = dom.canvas.querySelector(`.node[data-id="${node.id}"]`);

      if (parentEl && childEl) {
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
        const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("class", "connection-line");
        path.setAttribute("d", d);
        dom.svgLayer.appendChild(path);
      }
    }
  });
}

// --- چینش خودکار نرم (Smooth ReArrange) ---
function autoArrange() {
  const oldPos = {};
  nodes.forEach((n) => (oldPos[n.id] = { x: n.x, y: n.y }));

  const roots = nodes.filter((n) => !n.parent);
  if (roots.length === 0) return;

  let currentX = 300;
  let currentY = 50;

  roots.forEach((root) => {
    let bounds = {
      minX: currentX,
      maxX: currentX,
      minY: currentY,
      maxY: currentY,
    };
    layoutTree(root, currentX, currentY, bounds);
    currentY = bounds.maxY + 75;
  });

  nodes.forEach((node) => {
    const el = dom.canvas.querySelector(`.node[data-id="${node.id}"]`);
    if (el) {
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
    }
  });

  nodes.forEach((node) => {
    const children = nodes.filter((n) => n.parent === node.id);
    if (children.length > 0) {
      const nodeEl = dom.canvas.querySelector(`.node[data-id="${node.id}"]`);
      const firstChildEl = dom.canvas.querySelector(
        `.node[data-id="${children[0].id}"]`,
      );
      if (nodeEl && firstChildEl) {
        const nodeRect = nodeEl.getBoundingClientRect();
        const childRect = firstChildEl.getBoundingClientRect();
        const childCenter = childRect.top + childRect.height / 2;
        const nodeCenter = nodeRect.top + nodeRect.height / 2;
        node.y += Math.round(childCenter - nodeCenter);
      }
    }
  });

  nodes.forEach((node) => saveNode(node));

  nodes.forEach((node) => {
    const el = dom.canvas.querySelector(`.node[data-id="${node.id}"]`);
    if (el) {
      el.style.left = `${oldPos[node.id].x}px`;
      el.style.top = `${oldPos[node.id].y}px`;
    }
  });

  dom.canvas.offsetWidth;

  nodes.forEach((node) => {
    const el = dom.canvas.querySelector(`.node[data-id="${node.id}"]`);
    if (el) {
      el.classList.add("smooth-arrange");
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
    }
  });

  const start = performance.now();
  function animateLoop(now) {
    drawConnections();
    if (now - start < 350) {
      requestAnimationFrame(animateLoop);
    } else {
      nodes.forEach((node) => {
        const el = dom.canvas.querySelector(`.node[data-id="${node.id}"]`);
        if (el) el.classList.remove("smooth-arrange");
      });
    }
  }
  requestAnimationFrame(animateLoop);
}

function layoutTree(node, x, y, bounds) {
  if (x < bounds.minX) bounds.minX = x;
  if (x > bounds.maxX) bounds.maxX = x;
  if (y < bounds.minY) bounds.minY = y;
  if (y > bounds.maxY) bounds.maxY = y;

  node.x = x;
  node.y = y;

  const children = nodes.filter((n) => n.parent === node.id);
  let childY = y;
  children.forEach((child) => {
    layoutTree(child, x - 225, childY, bounds);
    childY += 75;
  });
}

// --- پان کردن محیط ---
let panData = null;
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

function handlePan(e) {
  if (!panData) return;
  const dx = e.clientX - panData.startX;
  const dy = e.clientY - panData.startY;
  dom.canvas.style.left = `${panData.initLeft + dx}px`;
  dom.canvas.style.top = `${panData.initTop + dy}px`;
  requestDraw();
}

function endPan() {
  localStorage.setItem("canvasX", parseInt(dom.canvas.style.left) || 0);
  localStorage.setItem("canvasY", parseInt(dom.canvas.style.top) || 0);
  panData = null;
  document.removeEventListener("mousemove", handlePan);
  document.removeEventListener("mouseup", endPan);
}

// --- شروع برنامه ---
initDB();
