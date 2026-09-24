/**
 * @module diff
 * @description Semantic diff engine for history snapshots: computes the
 * meaningful changes between two node arrays (position-only moves are
 * ignored) and renders them in the before/after comparison modal.
 */
import { dom } from "./dom.js";
import { nodeParentIds } from "./utils.js";

/**
 * Wires the diff modal's close button. Call once during bootstrapping.
 * @returns {void}
 */
export function setupDiffModal() {
  document.getElementById("diff-close")?.addEventListener("click", () => {
    dom.diffModal?.classList.add("hidden");
  });
}

/**
 * Persian display label of a node ("سرفصل/وظیفه «title»").
 * @param {object} n
 * @returns {string}
 */
function nodeLabel(n) {
  const type = n?.type === "header" ? "سرفصل" : "وظیفه";
  return `${type} «${n?.title ?? "؟"}»`;
}

/**
 * Renders an id list as a quoted, comma-joined title list.
 *
 * @param {Array<object>} nodesArr Node array to resolve titles against.
 * @param {Array<string>} ids Input ids.
 * @returns {string}
 */
function parentsLabel(nodesArr, ids) {
  if (!ids || ids.length === 0) return "«بدون والد»";
  const titles = ids.map((id) => {
    const p = (nodesArr || []).find((n) => String(n.id) === String(id));
    return p ? p.title : "؟";
  });
  return `«${titles.join("، ")}»`;
}

/**
 * Extracts the text of a note record (string or `{text}` object).
 * @param {object|string|null} n
 * @returns {string}
 */
function noteText(n) {
  if (n == null) return "";
  if (typeof n === "object") return String(n.text ?? "");
  return String(n);
}

/**
 * Diffs two note arrays. Equal lengths are compared pairwise (edits);
 * differing lengths are diffed by text membership (additions/removals).
 *
 * @param {Array<object>} beforeNotes
 * @param {Array<object>} afterNotes
 * @returns {Array<{kind:("edited"|"added"|"removed"), oldText?:string, newText?:string, text?:string}>}
 */
function diffNotes(beforeNotes, afterNotes) {
  const b = Array.isArray(beforeNotes) ? beforeNotes : [];
  const a = Array.isArray(afterNotes) ? afterNotes : [];
  const out = [];

  if (b.length === a.length) {
    for (let i = 0; i < a.length; i++) {
      if (noteText(b[i]) !== noteText(a[i])) {
        out.push({
          kind: "edited",
          oldText: noteText(b[i]),
          newText: noteText(a[i]),
        });
      }
    }
    return out;
  }

  const beforeTexts = b.map(noteText);
  const afterTexts = a.map(noteText);
  const afterSet = new Set(afterTexts);
  const beforeSet = new Set(beforeTexts);
  beforeTexts.forEach((t) => {
    if (!afterSet.has(t)) out.push({ kind: "removed", text: t });
  });
  afterTexts.forEach((t) => {
    if (!beforeSet.has(t)) out.push({ kind: "added", text: t });
  });
  return out;
}

/**
 * Computes every semantic change between two node snapshots. Detected
 * kinds: `add`, `remove`, `title`, `done`, `cancelled`, `parent` (the
 * whole ordered input list) and `note`. Node coordinates (x/y) are
 * intentionally ignored — a pure move or re-arrangement is not a
 * semantic change.
 *
 * @param {Array<object>} beforeArr Previous snapshot.
 * @param {Array<object>} afterArr Next snapshot.
 * @returns {Array<object>} Change descriptors.
 */
function computeDiff(beforeArr, afterArr) {
  const before = beforeArr || [];
  const after = afterArr || [];
  const changes = [];
  const beforeMap = new Map(before.map((n) => [n.id, n]));
  const afterMap = new Map(after.map((n) => [n.id, n]));

  for (const a of after) {
    if (!beforeMap.has(a.id)) changes.push({ kind: "add", node: a });
  }
  for (const b of before) {
    if (!afterMap.has(b.id)) changes.push({ kind: "remove", node: b });
  }
  for (const b of before) {
    const a = afterMap.get(b.id);
    if (!a) continue;

    if ((b.title || "") !== (a.title || "")) {
      changes.push({ kind: "title", node: a, oldTitle: b.title || "" });
    }
    if (!!b.done !== !!a.done) {
      changes.push({ kind: "done", node: a, done: !!a.done });
    }
    if (!!b.cancelled !== !!a.cancelled) {
      changes.push({ kind: "cancelled", node: a, cancelled: !!a.cancelled });
    }
    const bParents = nodeParentIds(b).map(String);
    const aParents = nodeParentIds(a).map(String);
    if (JSON.stringify(bParents) !== JSON.stringify(aParents)) {
      changes.push({
        kind: "parent",
        node: a,
        oldParents: bParents,
        newParents: aParents,
      });
    }
    for (const nc of diffNotes(b.notes, a.notes)) {
      changes.push({ kind: "note", node: a, note: nc });
    }
  }
  return changes;
}

/**
 * Whether two snapshots differ in any semantic way (drives the "..."
 * diff button visibility in the history panel).
 *
 * @param {Array<object>} before
 * @param {Array<object>} after
 * @returns {boolean}
 */
export function hasSemanticDiff(before, after) {
  return computeDiff(before, after).length > 0;
}

/**
 * Renders the changes as two aligned text columns ("before" / "after"),
 * one line pair per change.
 *
 * @param {Array<object>} before
 * @param {Array<object>} after
 * @returns {{before: string, after: string}}
 */
function diffToTexts(before, after) {
  const changes = computeDiff(before, after);
  const beforeLines = [];
  const afterLines = [];

  changes.forEach((c) => {
    const name = nodeLabel(c.node);
    switch (c.kind) {
      case "add":
        beforeLines.push("—");
        afterLines.push(
          `${name}${c.node.done ? " ✓" : ""}${c.node.cancelled ? " ✕" : ""} (اضافه شد)`,
        );
        break;
      case "remove":
        beforeLines.push(`${name} (حذف شد)`);
        afterLines.push("—");
        break;
      case "title":
        beforeLines.push(`عنوانِ ${name}:\n«${c.oldTitle}»`);
        afterLines.push(`عنوانِ ${name}:\n«${c.node.title}»`);
        break;
      case "done":
        beforeLines.push(
          `${c.node.title}: ${c.done ? "انجام‌نشده" : "انجام‌شده ✓"}`,
        );
        afterLines.push(
          `${c.node.title}: ${c.done ? "انجام‌شده ✓" : "انجام‌نشده"}`,
        );
        break;
      case "cancelled":
        beforeLines.push(
          `${c.node.title}: ${c.cancelled ? "فعال" : "لغوشده ✕"}`,
        );
        afterLines.push(
          `${c.node.title}: ${c.cancelled ? "لغوشده ✕" : "فعال"}`,
        );
        break;
      case "parent":
        beforeLines.push(
          `ورودی‌هایِ ${name}: ${parentsLabel(before, c.oldParents)}`,
        );
        afterLines.push(
          `ورودی‌هایِ ${name}: ${parentsLabel(after, c.newParents)}`,
        );
        break;
      case "note": {
        const n = c.note;
        if (n.kind === "edited") {
          beforeLines.push(`یادداشتِ ${name}:\n«${n.oldText || "(خالی)"}»`);
          afterLines.push(`یادداشتِ ${name}:\n«${n.newText || "(خالی)"}»`);
        } else if (n.kind === "added") {
          beforeLines.push("—");
          afterLines.push(`یادداشتِ ${name}:\n«${n.text || "(خالی)"}»`);
        } else {
          beforeLines.push(`یادداشتِ ${name}:\n«${n.text || "(خالی)"}»`);
          afterLines.push("—");
        }
        break;
      }
    }
  });

  if (beforeLines.length === 0) {
    return {
      before: "(تغییر محتوایی نبوده — فقط جابجایی/چینش)",
      after: "(تغییر محتوایی نبوده — فقط جابجایی/چینش)",
    };
  }
  return { before: beforeLines.join("\n"), after: afterLines.join("\n") };
}

/**
 * Opens the before/after comparison modal for a history entry.
 *
 * @param {string} label Entry label (modal title).
 * @param {Array<object>} before Previous snapshot.
 * @param {Array<object>} after Next snapshot.
 * @returns {void}
 */
export function showDiffModal(label, before, after) {
  if (!dom.diffModal) return;
  document.getElementById("diff-label").textContent = label || "مقایسه";
  const { before: beforeText, after: afterText } = diffToTexts(before, after);
  document.getElementById("diff-before").textContent = beforeText;
  document.getElementById("diff-after").textContent = afterText;
  dom.diffModal.classList.remove("hidden");
}
