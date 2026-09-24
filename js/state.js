/**
 * @module state
 * @description Central mutable application state shared across modules.
 */

/**
 * Global application state.
 *
 * @type {object}
 * @property {IDBDatabase|null} db                  Opened IndexedDB handle (null until `initDB` resolves).
 * @property {Array<object>}    nodes               In-memory node graph across all pages (each node carries `pageId`).
 * @property {Array<object>}    pages              Pages (tabs); each `{id, title, createdAt}`.
 * @property {string|null}      activePageId       Id of the currently visible page.
 * @property {HTMLElement|null} activeEl            DOM element of the node targeted by the most recent right-click.
 * @property {object|null}      dragData            Active drag session; shape depends on `type` (`move-node`, `new-connection`, `move-connection`). Null when idle.
 * @property {boolean}          isDrawing           Guard coalescing connection redraws into one per animation frame.
 * @property {string|null}      editingNodeId       Id of the node being created/edited in the input modal, null otherwise.
 * @property {string|null}      currentNoteNodeId   Id of the node whose notes menu is open.
 * @property {string|null}      detailsNodeId       Id of the task shown in the details modal, null when closed.
 * @property {number}           editingNoteIndex    Index of the note being edited within the node's `notes` array; -1 when adding a new one.
 * @property {Function|null}    pendingDeleteAction Callback executed when the user confirms the destructive-action dialog.
 * @property {object|null}      panData             Active canvas pan session (`startX`, `startY`, `initLeft`, `initTop`). Null when idle.
 * @property {Array<object>}    toastTimers         Bookkeeping for active toasts: `{element, remaining, startTime, timerId}`.
 * @property {boolean}          isToastPaused       Whether toast lifetimes are paused (pointer over the toast stack).
 */
export const state = {
  db: null,
  nodes: [],
  pages: [],
  activePageId: null,
  activeEl: null,
  dragData: null,
  isDrawing: false,
  editingNodeId: null,
  currentNoteNodeId: null,
  detailsNodeId: null,
  editingNoteIndex: -1,
  pendingDeleteAction: null,
  panData: null,
  toastTimers: [],
  isToastPaused: false,
};
