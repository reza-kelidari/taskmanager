/**
 * @module config
 * @description Single source of truth for every tunable constant in the
 * application (layout metrics, animation timings, limits, thresholds).
 */

/**
 * Global configuration constants.
 *
 * @readonly
 * @enum {number}
 * @property {number} GAP                     Horizontal free space (px) between a parent's left edge and its child's right edge (one layout level).
 * @property {number} VERTICAL_GAP            Vertical free space (px) between consecutive sibling subtrees.
 * @property {number} FALLBACK_HEIGHT         Node height (px) assumed when the rendered element cannot be measured.
 * @property {number} FALLBACK_WIDTH          Node width (px) assumed when the rendered element cannot be measured.
 * @property {number} OVERLAP_PUSH_AMOUNT     Vertical distance (px) a dragged node is pushed per overlap-resolution iteration.
 * @property {number} MAX_OVERLAP_ITERATIONS  Safety cap for the overlap-resolution loop.
 * @property {number} MODAL_MARGIN            Minimum distance (px) between a floating modal and the viewport edges.
 * @property {number} GROUP_TOOLTIP_OFFSET    Vertical offset (px) used when positioning group tooltips.
 * @property {number} HISTORY_MAX_STEPS       Maximum number of undoable history steps retained; the oldest entry is evicted when exceeded.
 * @property {number} ANIMATION_DURATION      Duration (ms) of layout, pan and node transition animations.
 * @property {number} MIN_DRAG_THRESHOLD      Pointer displacement (px) required before a mouse-down counts as a drag.
 * @property {number} TOAST_DURATION          Lifetime (ms) of a toast notification.
 * @property {number} DEBOUNCE_DELAY          Debounce interval (ms) for the search input.
 * @property {number} CANVAS_INITIAL_Y_OFFSET Y coordinate (canvas space) at which the first root tree is laid out.
 * @property {number} ERROR_LOG_MAX_SIZE      Maximum number of entries kept in the persistent error log.
 * @property {number} PERFORMANCE_THRESHOLD   Duration (ms) above which a measured operation is reported as slow.
 * @property {number} LEVEL_STEP              Vertical distance (px) between the main row and the row one level below it in the shortcut pattern (A > B > C plus A > C).
 */
export const CONFIG = {
  GAP: 70,
  VERTICAL_GAP: 25,
  FALLBACK_HEIGHT: 40,
  FALLBACK_WIDTH: 150,
  OVERLAP_PUSH_AMOUNT: 100,
  MAX_OVERLAP_ITERATIONS: 5,
  MODAL_MARGIN: 10,
  GROUP_TOOLTIP_OFFSET: 15,
  HISTORY_MAX_STEPS: 25,
  ANIMATION_DURATION: 350,
  MIN_DRAG_THRESHOLD: 2,
  TOAST_DURATION: 5000,
  DEBOUNCE_DELAY: 150,
  CANVAS_INITIAL_Y_OFFSET: 40,
  ERROR_LOG_MAX_SIZE: 100,
  PERFORMANCE_THRESHOLD: 16,
  LEVEL_STEP: 65,
};
