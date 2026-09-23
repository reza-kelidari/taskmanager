import { CONFIG } from "./config.js";
import { errorReporter } from "./error.js";

const HISTORY_STORAGE_KEY = "tm-history-v1";

class History {
  constructor(maxSteps = CONFIG.HISTORY_MAX_STEPS) {
    this.stack = [];
    this.currentIndex = -1;
    this.maxSteps = maxSteps;
  }

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

  // ---------- عملیات ----------

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

  undo() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.updateButtons();
      this._save();
      return JSON.parse(JSON.stringify(this.stack[this.currentIndex].nodes));
    }
    return null;
  }

  redo() {
    if (this.currentIndex < this.stack.length - 1) {
      this.currentIndex++;
      this.updateButtons();
      this._save();
      return JSON.parse(JSON.stringify(this.stack[this.currentIndex].nodes));
    }
    return null;
  }

  jumpTo(index) {
    if (index < 0 || index >= this.stack.length) return null;
    this.currentIndex = index;
    this.updateButtons();
    this._save();
    return JSON.parse(JSON.stringify(this.stack[index].nodes));
  }

  canUndo() {
    return this.currentIndex > 0;
  }
  canRedo() {
    return this.currentIndex < this.stack.length - 1;
  }
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

  updateButtons() {
    const undoBtn = document.getElementById("tool-undo");
    const redoBtn = document.getElementById("tool-redo");
    if (undoBtn) undoBtn.disabled = !this.canUndo();
    if (redoBtn) redoBtn.disabled = !this.canRedo();
  }
}

export const history = new History();
