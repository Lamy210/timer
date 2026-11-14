import test from "node:test";
import assert from "node:assert/strict";
import { buildIcsEvent, escapeIcsText, toIcsUtc } from "../../public/js/ics.js";

test("toIcsUtc formats UTC timestamps", () => {
  assert.equal(toIcsUtc(Date.UTC(2026, 10, 12, 1, 2, 3)), "20261112T010203Z");
});

test("escapeIcsText escapes separators and newlines", () => {
  assert.equal(escapeIcsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

test("buildIcsEvent includes times, title, memo, and agenda", () => {
  const start = Date.UTC(2026, 10, 12, 1, 0, 0);
  const ics = buildIcsEvent({
    title: "定例, 会議",
    memo: "背景\nメモ",
    agenda: [{ name: "A", min: 5, sec: 0 }],
    startMs: start,
    endMs: start + 30 * 60000,
    now: start
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261112T010000Z/);
  assert.match(ics, /DTEND:20261112T013000Z/);
  assert.match(ics, /SUMMARY:定例\\, 会議/);
  assert.match(ics, /DESCRIPTION:背景\\nメモ\\n\\n1\. A \(5分\)/);
  assert.match(ics, /UID:mtg-timer-/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});
