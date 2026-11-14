import test from "node:test";
import assert from "node:assert/strict";
import {
  buildItems,
  createRun,
  hydrateRun,
  advanceToNext,
  autoComplete,
  resetBeepFlags,
  extendRun,
  skipCurrent,
  goBack,
  pauseRun,
  resumeRun
} from "../../public/js/run-state.js";

const NOW = 1_000_000;
const ROWS = [
  { name: "A", min: 1, sec: 0 },
  { name: "B", min: 1, sec: 0 },
  { name: "C", min: 1, sec: 0 }
];

function normalRun() {
  const planStartMs = NOW + 120000;
  const items = buildItems(ROWS, planStartMs).items;
  return createRun({
    title: "定例",
    extendMin: 5,
    planStartMs,
    actStartMs: planStartMs,
    meetEndMs: planStartMs + 180000,
    preEndSec: 30,
    overrunMode: true,
    items,
    mode: "plan",
    preStartMin: 1,
    now: NOW
  }).run;
}

test("buildItems keeps positive durations and appends cumulative end times", () => {
  const result = buildItems([
    { name: "A", min: 1, sec: 0 },
    { name: "B", min: 0, sec: 30 },
    { name: "zero", min: 0, sec: 0 }
  ], 5000);
  assert.equal(result.cum, 90);
  assert.deepEqual(result.items.map((item) => item.name), ["A", "B"]);
  assert.equal(result.items[0].endMs, 65000);
  assert.equal(result.items[1].endMs, 95000);
  assert.equal(result.items[0].status, "wait");
});

test("createRun builds pre/meet alarm state and starts the first agenda", () => {
  const planStartMs = NOW + 120000;
  const items = buildItems(ROWS, planStartMs).items;
  const { run, skipped } = createRun({
    title: "定例",
    extendMin: 5,
    planStartMs,
    actStartMs: planStartMs,
    meetEndMs: planStartMs + 180000,
    preEndSec: 30,
    overrunMode: true,
    items,
    mode: "plan",
    preStartMin: 1,
    now: NOW
  });
  assert.equal(skipped, 0);
  assert.equal(run.idx, 0);
  assert.equal(run.items[0].status, "run");
  assert.equal(run.startPreEnabled, true);
  assert.equal(run.startPreMs, planStartMs - 60000);
  assert.equal(run.startPreFired, false);
  assert.equal(run.startPreMissed, false);
  assert.equal(run.meetPreEnabled, false);
  assert.equal(run.overrun, false);
  assert.equal(run.memo, "");
  assert.equal(run.paused, false);
  assert.equal(run.pausedAt, null);
});

test("createRun marks agendas that ended before a late start", () => {
  const items = buildItems(ROWS, NOW).items;
  const { run, skipped } = createRun({
    title: "",
    extendMin: 5,
    planStartMs: NOW,
    actStartMs: NOW + 130000,
    meetEndMs: NOW + 180000,
    preEndSec: 0,
    overrunMode: true,
    items,
    mode: "now",
    preStartMin: 0,
    now: NOW
  });
  assert.equal(skipped, 2);
  assert.equal(run.items[0].status, "skip");
  assert.equal(run.items[1].status, "skip");
  assert.equal(run.idx, 2);
  assert.equal(run.items[2].status, "run");
  assert.match(run.items[0].note, /開始遅延/);
});

test("advanceToNext and autoComplete skip finished agendas", () => {
  const run = normalRun();
  const result = autoComplete(run, run.items[1].endMs + 1);
  assert.equal(result.chain, 2);
  assert.equal(result.beepNeeded, true);
  assert.equal(run.items[0].status, "done");
  assert.equal(run.items[1].status, "done");
  assert.equal(run.items[2].status, "run");
  assert.equal(run.idx, 2);

  const simple = { idx: -1, preEndSec: 0, items: [{ status: "wait", durMs: 1000 }] };
  assert.equal(advanceToNext(simple, 10).status, "run");
  assert.equal(simple.idx, 0);
});

test("resetBeepFlags clears run and item flags", () => {
  const run = normalRun();
  run.startBeepScheduled = true;
  run.startPreBeepScheduled = true;
  run.meetPreBeepScheduled = true;
  run.endBeepScheduled = true;
  run.items[0].preBeepScheduled = true;
  run.items[0].endBeepScheduled = true;
  resetBeepFlags(run);
  assert.equal(run.startBeepScheduled, false);
  assert.equal(run.startPreBeepScheduled, false);
  assert.equal(run.meetPreBeepScheduled, false);
  assert.equal(run.endBeepScheduled, false);
  assert.equal(run.items[0].preBeepScheduled, false);
  assert.equal(run.items[0].endBeepScheduled, false);
});

test("extendRun shifts the current and future schedule", () => {
  const run = normalRun();
  const meetEnd = run.meetEndMs;
  const currentEnd = run.items[0].endMs;
  const futureEnd = run.items[1].endMs;
  extendRun(run, 5, NOW);
  assert.equal(run.meetEndMs, meetEnd + 300000);
  assert.equal(run.items[0].endMs, currentEnd + 300000);
  assert.equal(run.items[1].endMs, futureEnd + 300000);
  assert.equal(run.items[2].endMs, futureEnd + 300000 + 60000);
});

test("extendRun recovers from overrun", () => {
  const run = normalRun();
  run.overrun = true;
  run.meetEndMs = NOW - 10000;
  extendRun(run, 5, NOW);
  assert.equal(run.meetEndMs, NOW + 300000);
  assert.equal(run.overrun, false);
  assert.equal(run.meetPreEnabled, true);
  assert.equal(run.meetPreMs, NOW + 270000);
  assert.equal(run.meetPreFired, false);
});

test("skipCurrent marks the current agenda skipped and advances", () => {
  const run = normalRun();
  const current = run.items[0];
  const { next } = skipCurrent(run, NOW);
  assert.equal(current.status, "skip");
  assert.equal(next, run.items[1]);
  assert.equal(run.idx, 1);
  assert.equal(run.items[1].status, "run");
});

test("goBack restores the previous agenda and yields the current time", () => {
  const run = normalRun();
  run.idx = 2;
  run.items[0].status = "done";
  run.items[1].status = "done";
  run.items[2].status = "run";
  const endMs = run.items[2].endMs;
  const result = goBack(run, NOW);
  assert.equal(result.to, run.items[1]);
  assert.equal(result.from, run.items[2]);
  assert.equal(result.endMs, endMs);
  assert.equal(run.idx, 1);
  assert.equal(run.items[1].status, "run");
  assert.equal(run.items[2].status, "skip");
  assert.equal(run.items[1].endMs, endMs);

  const empty = { idx: -1, meetEndMs: NOW, items: [{ status: "wait" }] };
  assert.equal(goBack(empty, NOW), null);
});

test("hydrateRun normalizes persisted state and clears transient flags", () => {
  const saved = {
    title: "x".repeat(120),
    extendMin: 100,
    overrunMode: false,
    overrun: true,
    meetEndMs: NOW + 60000,
    preEndSec: 1000,
    startPreEnabled: "yes",
    meetPreEnabled: 0,
    startPreFired: 1,
    startPreMissed: 0,
    meetPreFired: 1,
    startBeepScheduled: true,
    startPreBeepScheduled: true,
    meetPreBeepScheduled: true,
    endBeepScheduled: true,
    items: [{ note: null, preFired: "x", preBeepScheduled: true, endBeepScheduled: true }]
  };
  const run = hydrateRun(saved, NOW, false);
  assert.equal(run.ended, false);
  assert.equal(run.title.length, 100);
  assert.equal(run.memo, "");
  assert.equal(run.paused, false);
  assert.equal(run.pausedAt, null);
  assert.equal(run.extendMin, 60);
  assert.equal(run.overrunMode, false);
  assert.equal(run.overrun, false);
  assert.equal(run.preEndSec, 300);
  assert.equal(run.startPreEnabled, true);
  assert.equal(run.meetPreEnabled, false);
  assert.equal(run.startPreFired, true);
  assert.equal(run.startPreMissed, false);
  assert.equal(run.meetPreFired, true);
  assert.equal(run.startBeepScheduled, false);
  assert.equal(run.startPreBeepScheduled, false);
  assert.equal(run.meetPreBeepScheduled, false);
  assert.equal(run.endBeepScheduled, false);
  assert.equal(run.items[0].note, "");
  assert.equal(run.items[0].preFired, false);
  assert.equal(run.items[0].preBeepScheduled, false);
  assert.equal(run.items[0].endBeepScheduled, false);
});

test("pauseRun freezes state and resumeRun shifts the remaining schedule", () => {
  const run = normalRun();
  const pauseAt = run.actStartMs + 10000;
  const firstEnd = run.items[0].endMs;
  const secondEnd = run.items[1].endMs;
  const firstAnchor = run.items[0].anchorMs;
  const meetEnd = run.meetEndMs;

  assert.equal(pauseRun(run, pauseAt), true);
  assert.equal(run.paused, true);
  assert.equal(run.pausedAt, pauseAt);
  assert.equal(pauseRun(run, pauseAt + 1000), false);

  assert.equal(resumeRun(run, pauseAt + 60000), true);
  assert.equal(run.paused, false);
  assert.equal(run.pausedAt, null);
  assert.equal(run.items[0].endMs, firstEnd + 60000);
  assert.equal(run.items[1].endMs, secondEnd + 60000);
  assert.equal(run.items[0].anchorMs, firstAnchor + 60000);
  assert.equal(run.meetEndMs, meetEnd + 60000);
});

test("hydrateRun keeps a paused run paused and not overrun", () => {
  const saved = {
    title: "",
    memo: "",
    extendMin: 5,
    overrunMode: true,
    paused: true,
    pausedAt: NOW,
    overrun: true,
    meetEndMs: NOW - 1000,
    preEndSec: 0,
    startPreEnabled: false,
    meetPreEnabled: false,
    startPreFired: true,
    startPreMissed: false,
    meetPreFired: true,
    items: [{ status: "run", note: "", preFired: false }]
  };
  const run = hydrateRun(saved, NOW, true);
  assert.equal(run.paused, true);
  assert.equal(run.pausedAt, NOW);
  assert.equal(run.overrun, false);
});
