import { isAudioUnlocked, clearScheduled, scheduleSequence, audioNow } from "./alerts.js";
import { resetBeepFlags } from "./run-state.js";

let wakeLock = null;
export async function requestWakeLock() {
  try {
    if (!("wakeLock" in navigator)) return;
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (e) {}
}

export function releaseWakeLock() {
  try {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {}
}

export function scheduleAlarms(run) {
  resetBeepFlags(run);
  if (!run || run.ended) {
    clearScheduled();
    return;
  }
  if (run.overrun || run.paused) {
    clearScheduled();
    return;
  }
  if (!isAudioUnlocked()) {
    clearScheduled();
    return;
  }
  clearScheduled();
  const now = Date.now();
  const base = audioNow();
  const minLead = 80;
  const horizon = now + 24 * 60 * 60 * 1000;
  const at = (eventMs) => base + (eventMs - now) / 1000;

  if (!run.startAnnounced && run.actStartMs > now + minLead && run.actStartMs <= horizon) {
    if (scheduleSequence("item", at(run.actStartMs))) run.startBeepScheduled = true;
  }
  if (run.startPreEnabled && !run.startPreFired && run.startPreMs > now + minLead && run.startPreMs < run.actStartMs && run.startPreMs <= horizon) {
    if (scheduleSequence("preStart", at(run.startPreMs))) run.startPreBeepScheduled = true;
  }
  run.items.forEach((it) => {
    if (it.status !== "wait" && it.status !== "run") return;
    if (run.preEndSec > 0 && !it.preFired && it.durMs > run.preEndSec * 1000) {
      const preMs = it.endMs - run.preEndSec * 1000;
      if (preMs > now + minLead && preMs < it.endMs && preMs <= horizon) {
        if (scheduleSequence("pre", at(preMs))) it.preBeepScheduled = true;
      }
    }
    if (it.endMs > now + minLead && it.endMs <= horizon) {
      if (scheduleSequence("item", at(it.endMs))) it.endBeepScheduled = true;
    }
  });
  if (run.meetPreEnabled && !run.meetPreFired && run.meetPreMs > now + minLead && run.meetPreMs < run.meetEndMs && run.meetPreMs <= horizon) {
    if (scheduleSequence("pre", at(run.meetPreMs))) run.meetPreBeepScheduled = true;
  }
  if (run.meetEndMs > now + minLead && run.meetEndMs <= horizon) {
    if (scheduleSequence("end", at(run.meetEndMs))) run.endBeepScheduled = true;
  }
}

