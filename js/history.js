/**
 * @module history
 * @description Undo/redo stack with localStorage persistence
 * (`tm-history-v1`), a bounded number of undoable steps, and labeled
 * snapshots for the history panel.
 */
import { CONFIG } from "./config.js";
import { errorReporter } from "./error.js";

const HISTORY_STORAGE_KEY = "tm-history-v1";

/**
 * Snapshot-based history. Each entry stores a deep copy of the whole node
 * array plus a label and timestamp. The stack holds at most
 * `maxSteps + 1` entries (the current state plus `maxSteps` undoable
 * steps); the oldest entry is evicted on overflow. Because redo steps can
 * only originate from undone steps, redo depth is bounded implicitly.
 */
class History {
  /**
   * @param {number} [maxSteps] Maximum number of undoable steps.
   */
  constructor(maxSteps = CONFIG.HISTORY_MAX_STEPS) {
    /** @type {Array<{nodes: Array<object>, label: string, timestamp: number}>} */
    this.stack = [];
    /** @type {number} Index of the current state within the stack. */
    this.currentIndex = -1;
    this.maxSteps = maxSteps;
  }

  /**
   * Persists the stack. Falls back to keeping only the last 10 entries
   * when the full payload exceeds the storage quota.
   * @private
   * @returns {void}
   */
  _save() {
    try {
      localStorage.setItem(
        HISTORY_STORAGE_KEY,
        JSON.stringify({ stack: this.stack, currentIndex: this.currentIndex }),
      );
    } catch (e) {
      try {
        const trimmed = this.stack.slice(-10);
        const idx = Math.max(
          0,
          Math.min(this.currentIndex, trimmed.length - 1),
        );
        localStorage.setItem(
          HISTORY_STORAGE_KEY,
          JSON.stringify({ stack: trimmed, currentIndex: idx }),
        );
      } catch (e2) {
        errorReporter.report(e2, { context: "History._save" });
      }
    }
  }

  /**
   * Restores a previously persisted stack. Validates the payload shape and
   * clamps the saved index into range.
   *
   * @returns {boolean} True when a valid history was restored.
   */
  load() {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (
        !data ||
        !Array.isArray(data.stack) ||
        data.stack.length === 0 ||
        !data.stack.every((e) => e && Array.isArray(e.nodes))
      ) {
        return false;
      }
      this.stack = data.stack;
      let idx = Number(data.currentIndex);
      if (!Number.isInteger(idx)) idx = this.stack.length - 1;
      this.currentIndex = Math.max(0, Math.min(idx, this.stack.length - 1));
      this.updateButtons();
      return true;
    } catch (e) {
      this.stack = [];
      this.currentIndex = -1;
      return false;
    }
  }

  /**
   * Pushes a new state, discarding any redo tail first, then evicting the
   * oldest entry when the capacity is exceeded.
   *
   * @param {Array<object>} nodesState Node graph to snapshot (deep-copied).
   * @param {string} [label="تغییر"] Human-readable change label.
   * @returns {void}
   */
  push(nodesState, label = "تغییر") {
    try {
      this.stack = this.stack.slice(0, this.currentIndex + 1);
      const entry = {
        nodes: JSON.parse(JSON.stringify(nodesState)),
        label: label || "تغییر",
        timestamp: Date.now(),
      };
      this.stack.push(entry);

      const maxLen = this.maxSteps + 1;
      if (this.stack.length > maxLen) {
        this.stack = this.stack.slice(this.stack.length - maxLen);
      }
      this.currentIndex = this.stack.length - 1;
      this.updateButtons();
      this._save();
    } catch (error) {
      errorReporter.report(error, { context: "History.push" });
    }
  }

  /**
   * Steps one entry back.
   * @returns {Array<object>|null} Deep copy of the previous state, or null
   *   when nothing is undoable.
   */
  undo() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.updateButtons();
      this._save();
      return JSON.parse(JSON.stringify(this.stack[this.currentIndex].nodes));
    }
    return null;
  }

  /**
   * Steps one entry forward.
   * @returns {Array<object>|null} Deep copy of the next state, or null
   *   when nothing is redoable.
   */
  redo() {
    if (this.currentIndex < this.stack.length - 1) {
      this.currentIndex++;
      this.updateButtons();
      this._save();
      return JSON.parse(JSON.stringify(this.stack[this.currentIndex].nodes));
    }
    return null;
  }

  /**
   * Jumps directly to an arbitrary stack index (history panel clicks).
   *
   * @param {number} index Target stack index.
   * @returns {Array<object>|null} Deep copy of that state, or null when
   *   the index is out of range.
   */
  jumpTo(index) {
    if (index < 0 || index >= this.stack.length) return null;
    this.currentIndex = index;
    this.updateButtons();
    this._save();
    return JSON.parse(JSON.stringify(this.stack[index].nodes));
  }

  /** @returns {boolean} Whether an undo step exists. */
  canUndo() {
    return this.currentIndex > 0;
  }

  /** @returns {boolean} Whether a redo step exists. */
  canRedo() {
    return this.currentIndex < this.stack.length - 1;
  }

  /**
   * Undoable steps, most recent first. Each item carries the target index
   * (after undoing that step) plus before/after snapshots for the diff view.
   *
   * @returns {Array<{index:number, fromIndex:number, label:string, timestamp:number, before:Array<object>, after:Array<object>}>}
   */
  getUndoList() {
    const list = [];
    for (let i = this.currentIndex; i >= 1; i--) {
      const entry = this.stack[i];
      const prev = this.stack[i - 1];
      list.push({
        index: i - 1,
        fromIndex: i,
        label: entry.label,
        timestamp: entry.timestamp,
        before: prev.nodes,
        after: entry.nodes,
      });
    }
    return list;
  }

  /**
   * Redoable steps, nearest first. Same item shape as
   * {@link History#getUndoList}.
   *
   * @returns {Array<object>}
   */
  getRedoList() {
    const list = [];
    for (let i = this.currentIndex + 1; i < this.stack.length; i++) {
      const entry = this.stack[i];
      const prev = this.stack[i - 1];
      list.push({
        index: i,
        fromIndex: i - 1,
        label: entry.label,
        timestamp: entry.timestamp,
        before: prev.nodes,
        after: entry.nodes,
      });
    }
    return list;
  }

  /**
   * Enables/disables the toolbar undo/redo buttons according to the
   * current position.
   * @returns {void}
   */
  updateButtons() {
    const undoBtn = document.getElementById("tool-undo");
    const redoBtn = document.getElementById("tool-redo");
    if (undoBtn) undoBtn.disabled = !this.canUndo();
    if (redoBtn) redoBtn.disabled = !this.canRedo();
  }
}

export const history = new History();
