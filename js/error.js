/**
 * @module error
 * @description Centralized error reporting and lightweight performance
 * monitoring.
 */
import { CONFIG } from "./config.js";

/**
 * Collects, logs and persists errors. Keeps a capped ring buffer both in
 * memory and in localStorage (`errorLog`).
 */
class ErrorReporter {
  /**
   * @param {number} [maxSize] Maximum number of entries retained.
   */
  constructor(maxSize = CONFIG.ERROR_LOG_MAX_SIZE) {
    this.errors = [];
    this.maxSize = maxSize;
  }

  /**
   * Records an error with contextual metadata, logs it to the console and
   * persists the log. Persistence failures are swallowed on purpose —
   * reporting must never throw.
   *
   * @param {Error} error The caught error.
   * @param {object} [context={}] Free-form contextual metadata.
   * @returns {void}
   */
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
    } catch (e) {
      /* storage unavailable — in-memory log only */
    }
  }

  /**
   * Clears both the in-memory and the persisted error log.
   * @returns {void}
   */
  clear() {
    this.errors = [];
    localStorage.removeItem("errorLog");
  }
}

export const errorReporter = new ErrorReporter();

/**
 * Measures synchronous operations and warns when they exceed
 * {@link CONFIG.PERFORMANCE_THRESHOLD}.
 */
class PerformanceMonitor {
  constructor() {
    /** @type {Map<string, {duration: number, timestamp: number}>} */
    this.measurements = new Map();
  }

  /**
   * Runs `fn`, records its duration and warns when it is slow.
   *
   * @param {string} name Measurement label.
   * @param {Function} fn Synchronous function to measure.
   * @returns {*} Whatever `fn` returns.
   * @throws {*} Re-throws whatever `fn` throws, after reporting it.
   */
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
