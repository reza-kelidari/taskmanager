import { CONFIG } from "./config.js";
import { errorReporter } from "./error.js";

class History {
  constructor(maxSize = CONFIG.HISTORY_MAX_SIZE) {
    this.stack = [];
    this.currentIndex = -1;
    this.maxSize = maxSize;
  }

  push(nodesState) {
    try {
      this.stack = this.stack.slice(0, this.currentIndex + 1);
      this.stack.push(JSON.parse(JSON.stringify(nodesState)));
      if (this.stack.length > this.maxSize) this.stack.shift();
      else this.currentIndex++;
      this.updateButtons();
    } catch (error) {
      errorReporter.report(error, { context: "History.push" });
    }
  }

  undo() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.updateButtons();
      return JSON.parse(JSON.stringify(this.stack[this.currentIndex]));
    }
    return null;
  }

  redo() {
    if (this.currentIndex < this.stack.length - 1) {
      this.currentIndex++;
      this.updateButtons();
      return JSON.parse(JSON.stringify(this.stack[this.currentIndex]));
    }
    return null;
  }

  canUndo() {
    return this.currentIndex > 0;
  }
  canRedo() {
    return this.currentIndex < this.stack.length - 1;
  }

  updateButtons() {
    const undoBtn = document.getElementById("tool-undo");
    const redoBtn = document.getElementById("tool-redo");
    if (undoBtn) undoBtn.disabled = !this.canUndo();
    if (redoBtn) redoBtn.disabled = !this.canRedo();
  }
}

export const history = new History();
