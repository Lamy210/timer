import { clampNum, fmtClock } from "./time.js";

function rowDurationMs(row) {
  return Math.max(0, Number(row.min) || 0) * 60 + Math.max(0, Number(row.sec) || 0);
}

export function buildItems(rows, planStartMs) {
  const items = [];
  let cum = 0;
  rows.forEach((row) => {
    const dur = rowDurationMs(row);
    if (dur <= 0) return;
    cum += dur;
    items.push({
      name: row.name || "（無題の議題）",
      durMs: dur * 1000,
      endMs: planStartMs + cum * 1000,
      status: "wait",
      anchorMs: null,
      preFired: false,
      preBeepScheduled: false,
      endBeepScheduled: false,
      note: ""
    });
  });
  return { items, cum };
}

function suppressShortPreAlarm(run, item) {
  if (run.preEndSec > 0 && item.durMs <= run.preEndSec * 1000) item.preFired = true;
}

export function advanceToNext(run, anchorMs) {
  let i = run.idx + 1;
  while (i < run.items.length && run.items[i].status !== "wait") i++;
  if (i < run.items.length) {
    run.idx = i;
    const item = run.items[i];
    item.status = "run";
    item.anchorMs = Number.isFinite(anchorMs) ? anchorMs : Date.now();
    suppressShortPreAlarm(run, item);
    return item;
  }
  run.idx = -1;
  return null;
}

export function autoComplete(run, now) {
  let chain = 0;
  let beepNeeded = false;
  while (run.idx >= 0) {
    const item = run.items[run.idx];
    if (item.endMs > now) break;
    if (!item.endBeepScheduled) beepNeeded = true;
    item.status = "done";
    chain++;
    advanceToNext(run, Math.max(item.endMs, run.actStartMs));
  }
  return { chain, beepNeeded };
}

export function resetBeepFlags(run) {
  if (!run) return;
  run.startBeepScheduled = false;
  run.startPreBeepScheduled = false;
  run.meetPreBeepScheduled = false;
  run.endBeepScheduled = false;
  run.items.forEach((item) => {
    item.preBeepScheduled = false;
    item.endBeepScheduled = false;
  });
}

export function createRun(options) {
  const {
    title,
    extendMin,
    planStartMs,
    actStartMs,
    meetEndMs,
    preEndSec,
    overrunMode,
    items,
    mode,
    preStartMin,
    now
  } = options;
  const lastEndMs = items[items.length - 1].endMs;
  let skipped = 0;
  items.forEach((item) => {
    if (item.endMs <= actStartMs) {
      item.status = "skip";
      item.note = "開始遅延のためスキップ（終了時刻 " + fmtClock(item.endMs) + " 過ぎ）";
      skipped++;
    }
  });

  const startPreEnabled = mode === "plan" && planStartMs > now && preStartMin > 0;
  const startPreMs = planStartMs - preStartMin * 60000;
  const meetPreEnabled = preEndSec > 0 && meetEndMs - lastEndMs > preEndSec * 1000;
  const meetPreMs = meetEndMs - preEndSec * 1000;

  const run = {
    title,
    extendMin,
    planStartMs,
    actStartMs,
    meetEndMs,
    preEndSec,
    overrunMode,
    overrun: false,
    items,
    idx: -1,
    ended: false,
    startAnnounced: false,
    startPreEnabled,
    startPreMs,
    startPreFired: !startPreEnabled || startPreMs <= now,
    startPreMissed: startPreEnabled && startPreMs <= now,
    meetPreEnabled,
    meetPreMs,
    meetPreFired: !meetPreEnabled || meetPreMs <= actStartMs,
    startBeepScheduled: false,
    startPreBeepScheduled: false,
    meetPreBeepScheduled: false,
    endBeepScheduled: false
  };
  advanceToNext(run, actStartMs);
  return { run, skipped };
}

export function hydrateRun(saved, now, overrunMode) {
  const run = saved;
  run.ended = false;
  run.title = typeof run.title === "string" ? run.title.slice(0, 100) : "";
  run.extendMin = Number.isFinite(run.extendMin) ? clampNum(run.extendMin, 1, 60) : 5;
  run.overrunMode = overrunMode;
  run.overrun = !!run.overrun && now >= run.meetEndMs;
  run.preEndSec = clampNum(run.preEndSec, 0, 300);
  run.startPreEnabled = !!run.startPreEnabled;
  run.meetPreEnabled = !!run.meetPreEnabled;
  run.startPreFired = !!run.startPreFired;
  run.startPreMissed = !!run.startPreMissed;
  run.meetPreFired = !!run.meetPreFired;
  resetBeepFlags(run);
  run.items.forEach((item) => {
    if (typeof item.note !== "string") item.note = "";
    if (typeof item.preFired !== "boolean") item.preFired = false;
  });
  return run;
}

export function extendRun(run, minutes, now) {
  const delta = minutes * 60000;
  if (run.overrun) {
    run.meetEndMs = Math.max(run.meetEndMs, now) + delta;
    run.overrun = false;
    run.meetPreEnabled = run.preEndSec > 0;
    run.meetPreMs = run.meetEndMs - run.preEndSec * 1000;
    run.meetPreFired = !run.meetPreEnabled || run.meetPreMs <= now;
    return;
  }
  run.meetEndMs += delta;
  if (run.idx >= 0) {
    const current = run.items[run.idx];
    current.endMs += delta;
    current.preFired = false;
    for (let i = run.idx + 1; i < run.items.length; i++) {
      if (run.items[i].status === "wait") run.items[i].endMs += delta;
    }
  }
  const lastEndMs = run.items.length ? run.items[run.items.length - 1].endMs : run.meetEndMs;
  run.meetPreEnabled = run.preEndSec > 0 && run.meetEndMs - lastEndMs > run.preEndSec * 1000;
  run.meetPreMs = run.meetEndMs - run.preEndSec * 1000;
  run.meetPreFired = !run.meetPreEnabled || run.meetPreMs <= now;
}

export function skipCurrent(run, now) {
  const current = run.items[run.idx];
  current.status = "skip";
  advanceToNext(run, now);
  autoComplete(run, now);
  return { current, next: run.idx >= 0 ? run.items[run.idx] : null };
}

export function goBack(run, now) {
  let index = -1;
  if (run.idx >= 0) {
    for (let i = run.idx - 1; i >= 0; i--) {
      if (run.items[i].status === "done" || run.items[i].status === "skip") {
        index = i;
        break;
      }
    }
  } else {
    for (let i = run.items.length - 1; i >= 0; i--) {
      if (run.items[i].status === "done" || run.items[i].status === "skip") {
        index = i;
        break;
      }
    }
  }
  if (index < 0) return null;
  const from = run.idx >= 0 ? run.items[run.idx] : null;
  const to = run.items[index];
  const endMs = from ? from.endMs : run.meetEndMs;
  to.status = "run";
  to.endMs = endMs;
  to.anchorMs = now;
  to.preFired = false;
  suppressShortPreAlarm(run, to);
  if (from) from.status = "skip";
  run.idx = index;
  return { from, to, endMs };
}
