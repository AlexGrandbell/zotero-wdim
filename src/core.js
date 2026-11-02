/* SPDX-License-Identifier: MIT */
// Pure PDF geometry and matching helpers, also exercised by Node's test runner.
var WDIMCore = (() => {
  const COLOR = "#e56b35";
  const SIZE = 22;

  function makePosition(anchor, box, fromSelection = false) {
    if (!Number.isInteger(anchor?.pageIndex) || anchor.pageIndex < 0
      || !anchor.rects?.length || !box || box.length !== 4
      || !box.every(Number.isFinite)) throw new Error("PDF position unavailable");
    const r = anchor.rects.at(-1);
    if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isFinite)) {
      throw new Error("Invalid PDF rectangle");
    }
    const width = Math.min(SIZE, box[2] - box[0]);
    const height = Math.min(SIZE * 1.3, box[3] - box[1]);
    if (width <= 0 || height <= 0) throw new Error("Invalid PDF page bounds");
    // Beside selected text, or centered on the user's click. All units are PDF points.
    const x = fromSelection ? r[2] + 4 : r[0] - width / 2;
    const y = fromSelection ? r[1] - 2 : r[1] - height / 2;
    const left = Math.max(box[0], Math.min(x, box[2] - width));
    const bottom = Math.max(box[1], Math.min(y, box[3] - height));
    return {
      pageIndex: anchor.pageIndex,
      rects: [[left, bottom, left + width, bottom + height]],
      fontSize: SIZE,
      rotation: 0
    };
  }

  function sameQuestion(annotation, position) {
    if (annotation?.type !== "text" || annotation.comment?.trim() !== "?"
      || annotation.position?.pageIndex !== position.pageIndex) return false;
    const a = annotation.position.rects?.[0];
    const b = position.rects?.[0];
    if (!a || !b) return false;
    // Compare centers, not quantized cells, so clicks across a cell boundary still merge.
    return Math.hypot((a[0] + a[2] - b[0] - b[2]) / 2,
      (a[1] + a[3] - b[1] - b[3]) / 2) <= 14;
  }

  function isShortcut(event, mac = true) {
    return event.code === "Slash" && !event.shiftKey && !event.altKey
      && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
  }

  function isEditable(target) {
    return !!target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]');
  }

  return { COLOR, SIZE, makePosition, sameQuestion, isShortcut, isEditable };
})();

if (typeof module !== "undefined") module.exports = WDIMCore;
