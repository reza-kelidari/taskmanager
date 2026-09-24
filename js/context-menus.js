/**
 * @module context-menus
 * @description Right-click menus: the canvas context menu (create
 * header/task), the element menu (edit / delete / done / cancelled /
 * suspended / notes / move-to) and the global dismiss-on-outside-press
 * behavior.
 *
 * Menus owned by other modules — #page-menu (tab bar),
 * #details-comment-menu (details modal) and #move-menu (move module) —
 * are deliberately excluded from both the global contextmenu handler
 * and the generic menu-item click wiring, so their own handlers keep
 * full control.
 */
import { state } from "./state.js";
import { dom, hideAllMenus, hideAllModals, positionFloating } from "./dom.js";
import { isActivePageNode } from "./utils.js";
import {
  saveNode,
  deleteNodeDB,
  setNodeDoneStatus,
  setNodeCancelledStatus,
  setNodeSuspendedStatus,
} from "./db.js";
import { history } from "./history.js";
import { drawConnections } from "./connections.js";
import { showNotesMenu } from "./notes.js";
import { showInputModal } from "./modals.js";
import { showMoveMenu } from "./move.js";

/**
 * @typedef {object} AppActions
 * @property {Function} renderNodes Re-renders all nodes.
 * @property {Function} autoArrange Runs the automatic layout.
 */

/**
 * Wires the right-click menus and their item actions.
 *
 * @param {AppActions} actions Application callbacks.
 * @returns {void}
 */
export function setupContextMenus(actions) {
  /**
   * Global contextmenu handler: prepares and positions the element menu
   * (on a node) or the canvas menu (on empty canvas). Task items are
   * mutually exclusive — only one of done/cancelled/suspended shows.
   *
   * The tabs bar and the details modal own their own right-click menus
   * and are skipped entirely. Skipping matters for ordering: a listener
   * on a descendant (the tab element) fires *before* this document-level
   * one, so any hideAllMenus() call here would close a menu their
   * handler has just opened. While the task details modal is open,
   * right-clicks never close it either.
   */
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (dom.detailsModal && !dom.detailsModal.classList.contains("hidden"))
      return;
    // Owned by the pages module (#page-menu) and the details module
    // (#details-comment-menu) — do not interfere.
    if (e.target.closest("#tabs-bar") || e.target.closest("#details-modal")) {
      return;
    }
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
      const cancelItem = dom.elementMenu.querySelector(
        '[data-action="toggle-cancelled"]',
      );
      const suspendItem = dom.elementMenu.querySelector(
        '[data-action="toggle-suspended"]',
      );
      const notesItem = dom.elementMenu.querySelector(
        '[data-action="comments"]',
      );
      const moveItem = dom.elementMenu.querySelector(
        '[data-action="move-to"]',
      );
      const editItem = dom.elementMenu.querySelector('[data-action="edit"]');
      if (nodeData.type === "task") {
        toggleItem.style.display =
          nodeData.cancelled || nodeData.suspended ? "none" : "flex";
        toggleItem.innerText = nodeData.done ? "انجام‌نشده" : "انجام‌شده";
        cancelItem.style.display =
          nodeData.done || nodeData.suspended ? "none" : "flex";
        cancelItem.innerText = nodeData.cancelled ? "لغونشده" : "لغوشده";
        suspendItem.style.display =
          nodeData.done || nodeData.cancelled ? "none" : "flex";
        suspendItem.innerText = nodeData.suspended ? "تعلیق‌نشده" : "تعلیق‌شده";
        notesItem.style.display = "none";
        editItem.style.display = "none";
        moveItem.style.display = state.pages.length > 1 ? "flex" : "none";
      } else {
        toggleItem.style.display = "none";
        cancelItem.style.display = "none";
        suspendItem.style.display = "none";
        notesItem.style.display = "none";
        editItem.style.display = "flex";
        moveItem.style.display = state.pages.length > 1 ? "flex" : "none";
      }
      positionFloating(dom.elementMenu, e.clientX, e.clientY);
    } else if (e.target.closest("#canvas-wrapper")) {
      state.activeEl = null;
      const taskItem = dom.contextMenu.querySelector(
        '[data-action="new-task"]',
      );
      taskItem.classList.toggle(
        "disabled",
        !state.nodes.some((n) => n.type === "header" && isActivePageNode(n)),
      );
      positionFloating(dom.contextMenu, e.clientX, e.clientY);
    }
  });

  /**
   * Dismiss every menu/modal on an outside press. The history panel,
   * modal contents, #page-menu and #details-comment-menu (both carry
   * the .context-menu class) are exempt so their own click handling
   * survives. Right-clicks never dismiss the open task details modal.
   */
  document.addEventListener("mousedown", (e) => {
    if (
      e.button === 2 &&
      dom.detailsModal &&
      !dom.detailsModal.classList.contains("hidden")
    )
      return;
    if (
      !e.target.closest(".context-menu") &&
      !e.target.closest(".history-panel") &&
      !e.target.closest(".modal-content") &&
      !e.target.closest("#tool-more")
    ) {
      hideAllMenus();
      hideAllModals();
      state.editingNodeId = null;
    }
  });

  /**
   * Menu item actions — scoped to ONLY the two menus this module owns.
   * A generic ".context-menu .menu-item" selector would also capture
   * #page-menu and #details-comment-menu items. The canvas menu creates
   * nodes; the element menu edits, deletes (promoting children to the
   * deleted node's parent and scrubbing extra-input references),
   * toggles done/cancelled/suspended, or opens the notes menu.
   */
  document
    .querySelectorAll(
      "#context-menu .menu-item[data-action], #element-menu .menu-item[data-action]",
    )
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
            state.nodes.forEach((n) => {
              if (Array.isArray(n.extraParents)) {
                const filtered = n.extraParents.filter(
                  (id) => String(id) !== String(nodeId),
                );
                if (filtered.length !== n.extraParents.length) {
                  n.extraParents = filtered;
                  saveNode(n);
                }
              }
            });
            deleteNodeDB(nodeId);
            history.push(state.nodes, `حذف «${node.title}»`);
            actions.renderNodes();
            drawConnections();
            hideAllMenus();
          }
          if (action === "toggle-done") {
            setNodeDoneStatus(node, !node.done);
            history.push(
              state.nodes,
              node.done
                ? `انجام‌شده «${node.title}»`
                : `انجام‌نشده «${node.title}»`,
            );
            actions.renderNodes();
            actions.autoArrange();
            hideAllMenus();
          }
          if (action === "toggle-cancelled") {
            setNodeCancelledStatus(node, !node.cancelled);
            history.push(
              state.nodes,
              node.cancelled
                ? `لغوشده «${node.title}»`
                : `لغونشده «${node.title}»`,
            );
            actions.renderNodes();
            actions.autoArrange();
            hideAllMenus();
          }
          if (action === "toggle-suspended") {
            setNodeSuspendedStatus(node, !node.suspended);
            history.push(
              state.nodes,
              node.suspended
                ? `تعلیق‌شده «${node.title}»`
                : `تعلیق‌نشده «${node.title}»`,
            );
            actions.renderNodes();
            actions.autoArrange();
            hideAllMenus();
          }
          if (action === "comments") {
            state.currentNoteNodeId = nodeId;
            showNotesMenu(x, y, node);
            dom.elementMenu.classList.add("hidden");
          }
          if (action === "move-to") {
            showMoveMenu(x, y, node);
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
}
