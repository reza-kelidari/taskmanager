import { CONFIG } from "./config.js";

class ErrorReporter {
  constructor() {
    this.errors = [];
    this.maxSize = CONFIG.ERROR_LOG_MAX_SIZE;
  }

  report(error, context = {}) {
    const entry = {
      message: error.message || String(error),
      stack: error.stack || new Error().stack,
      timestamp: Date.now(),
      context,
      userAgent: navigator.userAgent,
    };
    this.errors.push(entry);
    if (this.errors.length > this.maxSize) this.errors.shift();
    console.error("[TaskManager Error]", entry);
    try {
      localStorage.setItem("errorLog", JSON.stringify(this.errors));
    } catch (e) {}
  }

  clear() {
    this.errors = [];
    localStorage.removeItem("errorLog");
  }
}

export const errorReporter = new ErrorReporter();

class PerformanceMonitor {
  constructor() {
    this.measurements = new Map();
  }

  measure(name, fn) {
    const start = performance.now();
    try {
      const result = fn();
      const duration = performance.now() - start;
      if (duration > CONFIG.PERFORMANCE_THRESHOLD) {
        console.warn(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
      }
      this.measurements.set(name, { duration, timestamp: Date.now() });
      return result;
    } catch (error) {
      errorReporter.report(error, { context: "PerformanceMonitor", name });
      throw error;
    }
  }
}

export const perfMonitor = new PerformanceMonitor();
