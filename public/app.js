import { TEMPLATES, STORAGE_HISTORY, loadSetupData, saveSetupData, loadRunData, saveRunData, clearRunData, serializeSetup, parseImportedSetup, loadHistory, saveHistoryEntry, deleteHistoryEntry, clearHistoryData, mergeHistoryEntries } from "./js/storage.js";
import { getSoundOn, setSoundOn, isAudioUnlocked, unlockAudio, playSequence, scheduleSequence, clearScheduled, audioNow, speak, cancelSpeech, notify, requestNotificationPermission, vibrateSequence } from "./js/alerts.js";
import { jstParts, fmtHMS, fmtClock, dayIndexJst, fmtClockRel, fmtPlanStartLabel, resolvePlanStartMs, getFixedStartInfoFromMs, dateTodToMs, fmtDur, remainSpeech, parseTime, todToMs, clampNum } from "./js/time.js";
const $ = (id) => document.getElementById(id);

let toastTimer = null;
function toast(msg, duration) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), duration || 4000);
}

function updateSoundButton() {
  const btn = $("soundBtn");
  if (!btn) return;
  const on = getSoundOn();
  if (!isAudioUnlocked()) {
    btn.textContent = "音声を有効化";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    return;
  }
  btn.textContent = on ? "音声あり" : "音声なし";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function updateNotifyButton() {
  const btn = $("notifyBtn");
  if (!btn) return;
  if (!("Notification" in window)) {
    btn.disabled = true;
    btn.textContent = "通知非対応";
    return;
  }
  if (Notification.permission === "granted") {
    btn.disabled = true;
    btn.textContent = "通知有効";
  } else if (Notification.permission === "denied") {
    btn.disabled = true;
    btn.textContent = "通知ブロック中";
  } else {
    btn.disabled = false;
    btn.textContent = "通知を有効化";
  }
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    if (!("wakeLock" in navigator)) return;
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch (e) {}
}

function releaseWakeLock() {
  try {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {}
}

const rows = [
  { name: "挨拶・議題確認", min: 1, sec: 0 },
  { name: "議題1：報告", min: 9, sec: 0 },
  { name: "議題2：討議", min: 15, sec: 0 },
  { name: "まとめ・次回予定", min: 5, sec: 0 }
];
const rowRefs = [];

function rowDur(r) {
  return Math.max(0, Number(r.min) || 0) * 60 + Math.max(0, Number(r.sec) || 0);
}

function numInput(obj, key, min, max) {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.min = min;
  inp.max = max;
  inp.value = obj[key];
  inp.style.width = "72px";
  inp.addEventListener("input", () => {
    const v = Number(inp.value);
    obj[key] = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
    updateCalc();
  });
  inp.addEventListener("change", () => {
    inp.value = obj[key];
    updateCalc();
  });
  return inp;
}

function focusAgendaArrow(index, title) {
  const row = document.querySelector(`#agendaBody tr:nth-child(${index + 1})`);
  if (!row) return;
  const btn = row.querySelector(`td.op button[title="${title}"]`);
  if (btn && !btn.disabled) {
    btn.focus();
    return;
  }
  const other = row.querySelector('td.op button[title="上へ移動"], td.op button[title="下へ移動"]');
  if (other && !other.disabled) {
    other.focus();
    return;
  }
  const name = row.querySelector("input.nm");
  if (name) name.focus();
}

function focusAgendaDelete(index) {
  const row = document.querySelector(`#agendaBody tr:nth-child(${index + 1})`);
  if (row) {
    const btn = row.querySelector("td.op button:last-child");
    if (btn && !btn.disabled) {
      btn.focus();
      return;
    }
  }
  $("addItem").focus();
}

function renderRows() {
  const body = $("agendaBody");
  body.innerHTML = "";
  rowRefs.length = 0;
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    const tdN = document.createElement("td");
    const inp = document.createElement("input");
    inp.className = "nm";
    inp.type = "text";
    inp.maxLength = 200;
    inp.value = r.name;
    inp.placeholder = "議題" + (i + 1);
    inp.setAttribute("aria-label", "議題" + (i + 1) + "の名前");
    inp.addEventListener("input", () => {
      rows[i].name = inp.value;
      scheduleSaveSetup();
    });
    tdN.appendChild(inp);

    const tdM = document.createElement("td");
    tdM.appendChild(numInput(r, "min", 0, 600));
    const tdS = document.createElement("td");
    tdS.appendChild(numInput(r, "sec", 0, 59));

    const tdE = document.createElement("td");
    tdE.className = "endc";

    const tdO = document.createElement("td");
    tdO.className = "op";
    const up = document.createElement("button");
    up.className = "mini";
    up.type = "button";
    up.textContent = "↑";
    up.title = "上へ移動";
    up.setAttribute("aria-label", "上へ移動");
    up.disabled = i === 0;
    up.addEventListener("click", () => {
      if (i === 0) return;
      const tmp = rows[i - 1];
      rows[i - 1] = rows[i];
      rows[i] = tmp;
      renderRows();
      focusAgendaArrow(i - 1, "上へ移動");
    });
    const down = document.createElement("button");
    down.className = "mini";
    down.type = "button";
    down.textContent = "↓";
    down.title = "下へ移動";
    down.setAttribute("aria-label", "下へ移動");
    down.disabled = i === rows.length - 1;
    down.addEventListener("click", () => {
      if (i === rows.length - 1) return;
      const tmp = rows[i + 1];
      rows[i + 1] = rows[i];
      rows[i] = tmp;
      renderRows();
      focusAgendaArrow(i + 1, "下へ移動");
    });
    const del = document.createElement("button");
    del.className = "mini";
    del.textContent = "削除";
    del.type = "button";
    del.disabled = rows.length <= 1;
    del.addEventListener("click", () => {
      rows.splice(i, 1);
      renderRows();
      focusAgendaDelete(Math.min(i, rows.length - 1));
    });
    tdO.appendChild(up);
    tdO.appendChild(down);
    tdO.appendChild(del);

    tr.appendChild(tdN);
    tr.appendChild(tdM);
    tr.appendChild(tdS);
    tr.appendChild(tdE);
    tr.appendChild(tdO);
    body.appendChild(tr);
    rowRefs.push({ end: tdE });
  });
  updateCalc();
}

function computePlanStartMs(ps, total, now) {
  if (ps == null) return null;
  const date = $("planDate").value;
  if (date) return dateTodToMs(date, ps);
  return total > 0 ? resolvePlanStartMs(ps, total, now) : todToMs(ps, now);
}

function updateCalc(skipSave) {
  const ps = parseTime($("planStart").value);
  const totalMin = clampNum($("totalMin").value, 0, 480);
  const total = totalMin * 60;
  const now = Date.now();
  const planStartMs = computePlanStartMs(ps, total, now);
  let cum = 0;
  rows.forEach((r, i) => {
    cum += rowDur(r);
    if (rowRefs[i]) {
      rowRefs[i].end.textContent = planStartMs == null ? "—" : fmtClockRel(planStartMs + cum * 1000, now);
    }
  });
  $("sumDisp").textContent = fmtDur(cum * 1000);
  $("restDisp").textContent = fmtDur(Math.max(0, total - cum) * 1000);
  $("planEndDisp").textContent = planStartMs == null ? "--:--:--" : fmtClockRel(planStartMs + total * 1000, now);

  refreshPlanDate();

  $("nowEndDisp").textContent = total > 0
    ? "今すぐ開始（再計算）：終了 " + fmtClockRel(now + total * 1000, now)
    : "今すぐ開始（再計算）：終了 --";
  const fixed = getFixedStartInfoFromMs(planStartMs, total, now);
  const planDate = $("planDate").value;
  $("startFixedBtn").disabled = !fixed;
  $("startFixedBtn").title = fixed
    ? "予定終了時刻を維持して今すぐ開始します"
    : planDate && planStartMs == null
      ? "開催日が不正です。日付を確認してください。"
      : "予定が2時間以上先か、会議が終了済みです。「今すぐ開始（再計算）」または「開始時刻まで待機」を使ってください。";

  let msg = "";
  if (ps == null) msg = "MTG開始時刻を入力してください。";
  else if (planDate && planStartMs == null) msg = "開催日を確認してください。";
  else if (total <= 0) msg = "会議の長さを入力してください。";
  else if (cum > total) msg = "割り振りが会議の長さを " + fmtDur((cum - total) * 1000) + " 超えています。";
  $("warn").textContent = msg;

  const preStart = clampNum($("preStartMin").value, 0, 60);
  const preEnd = clampNum($("preEndSec").value, 0, 300);
  const parts = [];
  if (planStartMs != null && preStart > 0) {
    const preMs = planStartMs - preStart * 60000;
    parts.push("開始前アラーム " + fmtClockRel(preMs, now) + (preMs <= now ? "（時間切れ）" : ""));
  } else {
    parts.push("開始前アラーム オフ");
  }
  if (preEnd > 0) parts.push("各議題の終了 " + preEnd + " 秒前に終了前アラーム");
  else parts.push("終了前アラーム オフ");
  $("alarmPreview").textContent = parts.join("　／　");
  if (!skipSave) scheduleSaveSetup();
}

let R = null;
let tickTimer = null;
let bannerTimer = null;
let lastRenderKey = "";
let runRowRefs = [];
let skipLockUntil = 0;
let backLockUntil = 0;
let extendLockUntil = 0;
let saveSetupTimer = null;
let runLockRelease = null;

function acquireRunLock() {
  if (!("locks" in navigator)) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      navigator.locks.request("mtg-timer-active-run", { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return;
        }
        resolve(true);
        return new Promise((release) => {
          runLockRelease = release;
        });
      }).catch(() => resolve(true));
    } catch (e) {
      resolve(true);
    }
  });
}

function releaseRunLock() {
  if (runLockRelease) {
    try { runLockRelease(); } catch (e) {}
    runLockRelease = null;
  }
}

function collectSetupData() {
  return {
    planStart: $("planStart").value,
    planDate: $("planDate").value,
    meetingTitle: $("meetingTitle").value.trim().slice(0, 100),
    totalMin: clampNum($("totalMin").value, 1, 480),
    preStartMin: clampNum($("preStartMin").value, 0, 60),
    preEndSec: clampNum($("preEndSec").value, 0, 300),
    overrunMode: $("overrunMode").checked,
    rows: rows.map((r) => ({ name: r.name, min: r.min, sec: r.sec }))
  };
}

function saveSetup() {
  saveSetupData(collectSetupData());
}

function scheduleSaveSetup() {
  if (saveSetupTimer) clearTimeout(saveSetupTimer);
  saveSetupTimer = setTimeout(saveSetup, 250);
}

function applySetupData(data) {
  if (!data) return false;
  if (data.planStart) $("planStart").value = data.planStart;
  if (data.planDate !== undefined) $("planDate").value = data.planDate;
  if (data.meetingTitle !== undefined) $("meetingTitle").value = data.meetingTitle;
  if (data.totalMin != null) $("totalMin").value = data.totalMin;
  if (data.preStartMin != null) $("preStartMin").value = data.preStartMin;
  if (data.preEndSec != null) $("preEndSec").value = data.preEndSec;
  if (typeof data.overrunMode === "boolean") $("overrunMode").checked = data.overrunMode;
  if (data.rows && data.rows.length) {
    rows.length = 0;
    data.rows.forEach((r) => {
      rows.push({ name: String(r.name || ""), min: clampNum(r.min, 0, 600), sec: clampNum(r.sec, 0, 59) });
    });
  }
  return true;
}

function loadSetup() {
  return applySetupData(loadSetupData());
}

function persistRun() {
  saveRunData(R);
}

async function restoreRun() {
  try {
    const saved = loadRunData();
    if (!saved) return false;
    const now = Date.now();
    const overrunMode = saved && saved.overrunMode !== false;
    const tooLate = overrunMode
      ? (!saved || now >= saved.meetEndMs + 2 * 60 * 60 * 1000)
      : (!saved || now >= saved.meetEndMs);
    if (!saved || saved.ended || !Array.isArray(saved.items) || !saved.items.length
      || !Number.isFinite(saved.planStartMs) || !Number.isFinite(saved.actStartMs)
      || !Number.isFinite(saved.meetEndMs) || tooLate) {
      clearRunData();
      return false;
    }
    const locked = await acquireRunLock();
    if (!locked) {
      toast("別タブでタイマーが実行中です。前回のタイマーは復元しません。");
      return false;
    }
    R = saved;
    R.ended = false;
    R.title = typeof R.title === "string" ? R.title.slice(0, 100) : "";
    R.extendMin = Number.isFinite(R.extendMin) ? clampNum(R.extendMin, 1, 60) : 5;
    $("extendMin").value = R.extendMin;
    R.overrunMode = overrunMode;
    R.overrun = !!R.overrun && now >= R.meetEndMs;
    R.preEndSec = clampNum(R.preEndSec, 0, 300);
    R.startPreEnabled = !!R.startPreEnabled;
    R.meetPreEnabled = !!R.meetPreEnabled;
    R.startPreFired = !!R.startPreFired;
    R.startPreMissed = !!R.startPreMissed;
    R.meetPreFired = !!R.meetPreFired;
    R.startBeepScheduled = false;
    R.startPreBeepScheduled = false;
    R.meetPreBeepScheduled = false;
    R.endBeepScheduled = false;
    R.items.forEach((it) => {
      if (typeof it.note !== "string") it.note = "";
      if (typeof it.preFired !== "boolean") it.preFired = false;
      it.preBeepScheduled = false;
      it.endBeepScheduled = false;
    });
    skipLockUntil = 0;
    backLockUntil = 0;
    extendLockUntil = 0;
    lastRenderKey = "";
    $("setup").hidden = true;
    $("run").hidden = false;
    document.title = "MTGタイマー｜実行中";
    requestWakeLock();
    tick();
    toast("前回のタイマーを復元しました。音声は「音声を有効化」を押してください。");
    return true;
  } catch (e) {
    releaseRunLock();
    return false;
  }
}

function buildItems(planStartMs) {
  const items = [];
  let cum = 0;
  rows.forEach((r) => {
    const dur = rowDur(r);
    if (dur <= 0) return;
    cum += dur;
    items.push({
      name: r.name || "（無題の議題）",
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

function suppressShortPreAlarm(it) {
  if (R.preEndSec > 0 && it.durMs <= R.preEndSec * 1000) it.preFired = true;
}

function advanceToNext(anchorMs) {
  let i = R.idx + 1;
  while (i < R.items.length && R.items[i].status !== "wait") i++;
  if (i < R.items.length) {
    R.idx = i;
    const it = R.items[i];
    it.status = "run";
    it.anchorMs = Number.isFinite(anchorMs) ? anchorMs : Date.now();
    suppressShortPreAlarm(it);
    return it;
  }
  R.idx = -1;
  return null;
}

function autoComplete(now) {
  let chain = 0;
  let beepNeeded = false;
  while (R.idx >= 0) {
    const it = R.items[R.idx];
    if (it.endMs > now) break;
    if (!it.endBeepScheduled) beepNeeded = true;
    it.status = "done";
    chain++;
    advanceToNext(Math.max(it.endMs, R.actStartMs));
  }
  return { chain: chain, beepNeeded: beepNeeded };
}

function resetBeepFlags() {
  if (!R) return;
  R.startBeepScheduled = false;
  R.startPreBeepScheduled = false;
  R.meetPreBeepScheduled = false;
  R.endBeepScheduled = false;
  R.items.forEach((it) => {
    it.preBeepScheduled = false;
    it.endBeepScheduled = false;
  });
}

function scheduleAlarms() {
  resetBeepFlags();
  if (!R || R.ended) {
    clearScheduled();
    return;
  }
  if (R.overrun) return;
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

  if (!R.startAnnounced && R.actStartMs > now + minLead && R.actStartMs <= horizon) {
    if (scheduleSequence("item", at(R.actStartMs))) R.startBeepScheduled = true;
  }
  if (R.startPreEnabled && !R.startPreFired && R.startPreMs > now + minLead && R.startPreMs < R.actStartMs && R.startPreMs <= horizon) {
    if (scheduleSequence("preStart", at(R.startPreMs))) R.startPreBeepScheduled = true;
  }
  R.items.forEach((it) => {
    if (it.status !== "wait" && it.status !== "run") return;
    if (R.preEndSec > 0 && !it.preFired && it.durMs > R.preEndSec * 1000) {
      const preMs = it.endMs - R.preEndSec * 1000;
      if (preMs > now + minLead && preMs < it.endMs && preMs <= horizon) {
        if (scheduleSequence("pre", at(preMs))) it.preBeepScheduled = true;
      }
    }
    if (it.endMs > now + minLead && it.endMs <= horizon) {
      if (scheduleSequence("item", at(it.endMs))) it.endBeepScheduled = true;
    }
  });
  if (R.meetPreEnabled && !R.meetPreFired && R.meetPreMs > now + minLead && R.meetPreMs < R.meetEndMs && R.meetPreMs <= horizon) {
    if (scheduleSequence("pre", at(R.meetPreMs))) R.meetPreBeepScheduled = true;
  }
  if (R.meetEndMs > now + minLead && R.meetEndMs <= horizon) {
    if (scheduleSequence("end", at(R.meetEndMs))) R.endBeepScheduled = true;
  }
}

function enableAudio() {
  unlockAudio(() => {
    updateSoundButton();
    scheduleAlarms();
  });
}

async function startRun(mode) {
  enableAudio();
  const rawTotal = Number($("totalMin").value);
  if (!Number.isFinite(rawTotal) || rawTotal < 1) {
    toast("会議の長さを1分以上で入力してください。");
    return;
  }
  const totalMin = Math.min(480, rawTotal);
  const totalSec = Math.round(totalMin * 60);
  const preStartMin = clampNum($("preStartMin").value, 0, 60);
  const preEndSec = clampNum($("preEndSec").value, 0, 300);
  const overrunMode = $("overrunMode").checked;
  const meetingTitle = $("meetingTitle").value.trim().slice(0, 100);
  const extendMin = clampNum($("extendMin").value, 1, 60);
  $("totalMin").value = totalMin;
  $("preStartMin").value = preStartMin;
  $("preEndSec").value = preEndSec;
  const now = Date.now();
  let planStartMs;

  if (mode === "now") {
    planStartMs = Math.floor(now / 1000) * 1000;
  } else {
    const ps = parseTime($("planStart").value);
    if (ps == null) {
      toast("MTG開始時刻（日本時間）を入力してください。");
      return;
    }
    const planDateValue = $("planDate").value;
    if (planDateValue) {
      planStartMs = dateTodToMs(planDateValue, ps);
      if (planStartMs == null) {
        toast("開催日が不正です。日付を確認してください。");
        return;
      }
      if (now >= planStartMs + totalSec * 1000) {
        toast("指定した日時は会議終了時刻を過ぎています。日付を確認するか、「今すぐ開始（再計算）」を使ってください。");
        return;
      }
    } else {
      planStartMs = resolvePlanStartMs(ps, totalSec, now);
    }
    if (mode === "fixed") {
      const info = getFixedStartInfoFromMs(planStartMs, totalSec, now);
      if (!info) {
        toast("予定が2時間以上先か、会議が終了済みです。「今すぐ開始（再計算）」または「開始時刻まで待機」を使ってください。");
        return;
      }
      planStartMs = info.planStartMs;
      if (planStartMs - now > 60 * 60 * 1000) {
        if (!window.confirm("予定より " + fmtDur(planStartMs - now) + " 早く開始します。終了時刻は予定どおりです。よろしいですか？")) return;
      }
    }
  }

  const built = buildItems(planStartMs);
  if (!built.items.length) {
    toast("時間を割り振った議題を1つ以上入力してください。");
    return;
  }
  if (built.cum > totalSec) {
    toast("割り振り合計が会議の長さを超えています。");
    return;
  }

  const locked = await acquireRunLock();
  if (!locked) {
    toast("別タブでタイマーが実行中です。");
    return;
  }

  if (mode === "now") {
    $("planDate").value = "";
    $("planStart").value = fmtHMS(planStartMs);
  }

  const actStartMs = mode === "fixed" ? now : Math.max(planStartMs, now);
  const meetEndMs = planStartMs + totalSec * 1000;
  const lastEndMs = built.items[built.items.length - 1].endMs;
  let skipped = 0;
  built.items.forEach((it) => {
    if (it.endMs <= actStartMs) {
      it.status = "skip";
      it.note = "開始遅延のためスキップ（終了時刻 " + fmtClock(it.endMs) + " 過ぎ）";
      skipped++;
    }
  });

  const startPreEnabled = mode === "plan" && planStartMs > now && preStartMin > 0;
  const startPreMs = planStartMs - preStartMin * 60000;
  const meetPreEnabled = preEndSec > 0 && meetEndMs - lastEndMs > preEndSec * 1000;
  const meetPreMs = meetEndMs - preEndSec * 1000;

  R = {
    title: meetingTitle,
    extendMin: extendMin,
    planStartMs: planStartMs,
    actStartMs: actStartMs,
    meetEndMs: meetEndMs,
    preEndSec: preEndSec,
    overrunMode: overrunMode,
    overrun: false,
    items: built.items,
    idx: -1,
    ended: false,
    startAnnounced: false,
    startPreEnabled: startPreEnabled,
    startPreMs: startPreMs,
    startPreFired: !startPreEnabled || startPreMs <= now,
    startPreMissed: startPreEnabled && startPreMs <= now,
    meetPreEnabled: meetPreEnabled,
    meetPreMs: meetPreMs,
    meetPreFired: !meetPreEnabled || meetPreMs <= actStartMs,
    startBeepScheduled: false,
    startPreBeepScheduled: false,
    meetPreBeepScheduled: false,
    endBeepScheduled: false
  };
  advanceToNext(actStartMs);
  skipLockUntil = 0;
  backLockUntil = 0;
  extendLockUntil = 0;
  lastRenderKey = "";

  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  $("setup").hidden = true;
  $("run").hidden = false;
  document.title = "MTGタイマー｜実行中";
  requestWakeLock();
  saveSetup();
  persistRun();
  scheduleAlarms();

  const dayDiff = dayIndexJst(planStartMs) - dayIndexJst(now);
  const lateMs = actStartMs - planStartMs;
  if (mode === "fixed") {
    if (lateMs > 5000) {
      toast("予定より " + fmtDur(lateMs) + " 遅れて開始します。" + (skipped > 0 ? skipped + "件の議題をスキップしました。" : ""));
    } else if (planStartMs - now > 5000) {
      toast("予定より " + fmtDur(planStartMs - now) + " 早く開始します。終了時刻は予定どおりです。");
    }
  } else if (lateMs > 5000) {
    toast("予定より " + fmtDur(lateMs) + " 遅れて開始します。" + (skipped > 0 ? skipped + "件の議題をスキップしました。" : ""));
  } else if (dayDiff > 0) {
    toast("開始予定は " + fmtPlanStartLabel(planStartMs, now) + " です。");
  }
  tick();
  $("curName").focus();
}

function showBanner(title, sub, voiceText, kind, holdMs) {
  $("bTitle").textContent = title;
  $("bSub").textContent = sub;
  $("bVoice").textContent = voiceText;
  const banner = $("banner");
  banner.classList.remove("endj", "pre", "start");
  if (kind) banner.classList.add(kind);
  banner.hidden = false;
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, holdMs || 8000);
}

function showEndBanner(manual, endMs) {
  showBanner("終 了", (manual ? "会議を終了しました" : "会議の終了時刻です") + "（日本時間 " + fmtClockRel(endMs, Date.now()) + "）", "終了", "endj", 30000);
}

function hideBanner() {
  $("banner").hidden = true;
}

function announceStart() {
  R.startAnnounced = true;
  R.startPreFired = true;
  if (!R.startBeepScheduled) playSequence("item");
  vibrateSequence("item");
  if (R.idx >= 0) {
    const it = R.items[R.idx];
    const endLabel = fmtClockRel(it.endMs, Date.now());
    const msg = "最初の議題は「" + it.name + "」です。終了時刻は" + endLabel + "です。";
    showBanner("MTG開始", "最初の議題：「" + it.name + "」　終了 " + endLabel, msg, "start", 8000);
    speak("MTGを開始します。" + msg);
    notify("MTG開始", "最初の議題「" + it.name + "」 終了 " + endLabel);
  } else if (R.meetEndMs > Date.now()) {
    showBanner("MTG開始", "議題はすべて終了しています", "MTGを開始します。議題はすべて終了しています。", "start", 8000);
    speak("MTGを開始します。議題はすべて終了しています。");
    notify("MTG開始", "議題はすべて終了しています。会議終了 " + fmtClockRel(R.meetEndMs, Date.now()));
  } else {
    showBanner("MTG終了", "会議の終了時刻を過ぎています", "会議の終了時刻を過ぎています。", "endj", 8000);
    speak("会議の終了時刻を過ぎています。");
    notify("MTG終了", "会議の終了時刻を過ぎています。");
  }
  persistRun();
}

function showNextAfterChain(now, beep) {
  if (beep) playSequence("item");
  vibrateSequence("item");
  if (R.idx >= 0) {
    const it = R.items[R.idx];
    const endLabel = fmtClockRel(it.endMs, Date.now());
    showBanner("次の内容に移ってください", "「" + it.name + "」　終了 " + endLabel, "次の内容に移ってください。" + it.name, "pre", 7000);
    speak("次の内容に移ってください。" + it.name);
    notify("次の議題", "「" + it.name + "」 終了 " + endLabel);
  } else if (R.meetEndMs > now) {
    showBanner("議題はすべて終了", "会議の終了 " + fmtClockRel(R.meetEndMs, now) + " まで自由時間です", "議題はすべて終わりました。会議はまもなく終了します。", "pre", 7000);
    speak("議題はすべて終わりました。会議はまもなく終了します。");
    notify("議題はすべて終了", "会議終了 " + fmtClockRel(R.meetEndMs, Date.now()));
  }
  persistRun();
}

function fireStartPreAlarm(now) {
  if (!R.startPreEnabled || R.startPreFired || now >= R.actStartMs) return;
  if (now < R.startPreMs) return;
  R.startPreFired = true;
  if (!R.startPreBeepScheduled) playSequence("preStart");
  vibrateSequence("preStart");
  const p = jstParts(R.actStartMs);
  const remain = R.actStartMs - now;
  const startLabel = fmtClockRel(R.actStartMs, now);
  const dayDiff = dayIndexJst(R.actStartMs) - dayIndexJst(now);
  const dayWord = dayDiff === 1 ? "明日" : dayDiff > 1 ? dayDiff + "日後" : "本日";
  showBanner("まもなくMTG開始", "開始 " + startLabel + "（あと " + fmtDur(remain) + "）", "まもなくMTGが始まります。開始時刻は" + dayWord + p.h + "時" + p.mi + "分です。", "pre", 7000);
  speak("まもなくMTGが始まります。開始時刻は" + dayWord + p.h + "時" + p.mi + "分です。");
  notify("まもなくMTG開始", "開始 " + startLabel + "（あと " + fmtDur(remain) + "）");
  persistRun();
}

function fireCurrentPreAlarm(now) {
  if (R.preEndSec <= 0 || R.idx < 0 || now < R.actStartMs) return;
  const it = R.items[R.idx];
  if (it.preFired || now >= it.endMs) return;
  const preMs = it.endMs - R.preEndSec * 1000;
  if (now < preMs) return;
  it.preFired = true;
  if (!it.preBeepScheduled) playSequence("pre");
  vibrateSequence("pre");
  const remain = it.endMs - now;
  const remainText = remainSpeech(remain);
  const endLabel = fmtClockRel(it.endMs, Date.now());
  showBanner("まもなく終了", "「" + it.name + "」　終了 " + endLabel + "（残り " + fmtDur(remain) + "）", "まもなく「" + it.name + "」が終了します。残り" + remainText + "です。", "pre", 7000);
  speak("まもなく「" + it.name + "」が終了します。残り" + remainText + "です。");
  notify("まもなく終了", "「" + it.name + "」 終了 " + endLabel + "（残り " + fmtDur(remain) + "）");
  persistRun();
}

function fireMeetingPreAlarm(now) {
  if (!R.meetPreEnabled || R.meetPreFired || R.ended) return;
  if (now < R.actStartMs || now < R.meetPreMs || now >= R.meetEndMs) return;
  R.meetPreFired = true;
  if (!R.meetPreBeepScheduled) playSequence("pre");
  vibrateSequence("pre");
  const remain = R.meetEndMs - now;
  const remainText = remainSpeech(remain);
  const endLabel = fmtClockRel(R.meetEndMs, now);
  showBanner("まもなく会議終了", "会議終了 " + endLabel + "（残り " + fmtDur(remain) + "）", "まもなく会議の終了時刻です。残り" + remainText + "です。", "pre", 7000);
  speak("まもなく会議の終了時刻です。残り" + remainText + "です。");
  notify("まもなく会議終了", "会議終了 " + endLabel + "（残り " + fmtDur(remain) + "）");
  persistRun();
}

function enterOverrun() {
  if (R.overrun) return;
  R.overrun = true;
  if (!R.endBeepScheduled) playSequence("end");
  vibrateSequence("end");
  showBanner("終了時刻を超過", "会議を終了するには「会議を終了」を押してください", "予定の終了時刻を過ぎました。会議を継続中です。終了する場合は会議を終了を押してください。", "endj", 15000);
  speak("予定の終了時刻を過ぎました。会議を継続中です。終了する場合は会議を終了を押してください。");
  notify("終了時刻を超過", "会議を終了するには「会議を終了」を押してください。");
  persistRun();
}

function endMeeting(manual) {
  const endMs = manual ? Date.now() : R.meetEndMs;
  R.ended = true;
  R.overrun = false;
  R.actualEndMs = endMs;
  releaseRunLock();
  R.items.forEach((it) => {
    if (it.status === "wait" || it.status === "run") it.status = "done";
  });
  R.idx = -1;
  recordHistory();
  if (manual || !R.endBeepScheduled) playSequence("end");
  vibrateSequence("end");
  if (manual) clearScheduled();
  showEndBanner(manual, endMs);
  speak(manual ? "会議を終了しました" : "終了");
  toast((manual ? "会議を終了しました" : "会議の終了時刻です") + "（日本時間 " + fmtClockRel(endMs, Date.now()) + "）");
  notify("会議終了", (manual ? "会議を終了しました" : "会議の終了時刻です") + "（日本時間 " + fmtClockRel(endMs, Date.now()) + "）");
  releaseWakeLock();
  clearRunData();
  if (document.hasFocus()) $("curName").focus();
}

function tick() {
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  if (!R) return;
  const now = Date.now();
  if (R.overrun && now < R.meetEndMs) {
    R.overrun = false;
    persistRun();
  }

  if (!R.ended && !R.overrun) {
    if (now >= R.meetEndMs) {
      if (R.overrunMode) {
        autoComplete(now);
        enterOverrun();
      } else {
        endMeeting(false);
      }
    } else if (now >= R.actStartMs) {
      const result = autoComplete(now);
      const chain = result.chain;
      if (chain > 0) persistRun();
      if (!R.startAnnounced) {
        announceStart();
      } else if (chain > 0) {
        showNextAfterChain(now, result.beepNeeded);
      }
      fireCurrentPreAlarm(now);
      fireMeetingPreAlarm(now);
    } else {
      fireStartPreAlarm(now);
      fireMeetingPreAlarm(now);
    }
  }

  renderRun(now);
  tickTimer = setTimeout(tick, R.ended ? 1000 : 250);
}

const ST = {
  done: ["済", "done"],
  run: ["実行中", "run"],
  wait: ["待機", "wait"],
  skip: ["スキップ", "skipc"]
};

function buildSummary(run) {
  const now = Date.now();
  const actualEnd = run.actualEndMs || run.meetEndMs;
  const lines = [
    "MTGタイマー結果",
    ...(run.title ? ["会議名: " + run.title] : []),
    "開始: " + fmtClockRel(run.actStartMs, now),
    "終了: " + fmtClockRel(actualEnd, now) + "（予定 " + fmtClockRel(run.meetEndMs, now) + "）",
    "予定: " + fmtClockRel(run.planStartMs, now) + " 〜 " + fmtClockRel(run.meetEndMs, now) + "（" + fmtDur(run.meetEndMs - run.planStartMs) + "）",
    "実際の長さ: " + fmtDur(actualEnd - run.actStartMs),
    ""
  ];
  run.items.forEach((it) => {
    lines.push("- " + it.name + " | 予定終了 " + fmtClockRel(it.endMs, now) + " | " + ST[it.status][0] + (it.note ? " | " + it.note : ""));
  });
  return lines.join("\n");
}

function recordHistory() {
  if (!R) return;
  saveHistoryEntry({
    id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8),
    title: R.title || "",
    planStartMs: R.planStartMs,
    actStartMs: R.actStartMs,
    meetEndMs: R.meetEndMs,
    actualEndMs: R.actualEndMs || R.meetEndMs,
    items: R.items.map((it) => ({ name: it.name, status: it.status, endMs: it.endMs, note: it.note }))
  });
  renderHistory();
}

function applyHistoryTemplate(entry) {
  if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) {
    toast("再利用できる議題がありません。");
    return;
  }
  const nextRows = [];
  let prev = entry.planStartMs;
  entry.items.forEach((it) => {
    const sec = Math.max(0, Math.round((it.endMs - prev) / 1000));
    prev = it.endMs;
    nextRows.push({ name: it.name, min: Math.floor(sec / 60), sec: sec % 60 });
  });
  if (!nextRows.some((row) => row.min > 0 || row.sec > 0)) {
    toast("再利用できる議題がありません。");
    return;
  }
  const total = Math.max(1, Math.min(480, Math.ceil((entry.meetEndMs - entry.planStartMs) / 60000)));
  $("meetingTitle").value = entry.title || "";
  $("totalMin").value = String(total);
  rows.length = 0;
  nextRows.forEach((row) => rows.push(row));
  renderRows();
  toast("会議履歴から議題を読み込みました。");
}

function renderHistory() {
  const card = $("historyCard");
  const list = $("historyList");
  if (!card || !list) return;
  const history = loadHistory();
  card.hidden = history.length === 0;
  list.innerHTML = "";
  const now = Date.now();
  history.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "historyItem";
    const main = document.createElement("div");
    main.className = "historyMain";
    const names = entry.items.map((it) => it.name).filter(Boolean);
    const nameText = entry.title || (names.slice(0, 5).join(" / ") + (names.length > 5 ? " ほか" + (names.length - 5) + "件" : ""));
    const nameDiv = document.createElement("div");
    nameDiv.className = "historyName";
    nameDiv.textContent = nameText || "（会議名なし）";
    const title = document.createElement("div");
    title.className = "historyTitle";
    title.textContent = "開始 " + fmtPlanStartLabel(entry.actStartMs, now) + "　／　終了 " + fmtClockRel(entry.actualEndMs, now);
    const meta = document.createElement("div");
    meta.className = "historyMeta";
    const skipped = entry.items.filter((it) => it.status === "skip").length;
    meta.textContent = "予定 " + fmtClockRel(entry.planStartMs, now) + " 〜 " + fmtClockRel(entry.meetEndMs, now)
      + "　／　実際 " + fmtDur(entry.actualEndMs - entry.actStartMs)
      + "　／　" + entry.items.length + "件"
      + (skipped > 0 ? "（スキップ " + skipped + "件）" : "");
    const agenda = document.createElement("div");
    agenda.className = "historyAgenda";
    agenda.textContent = names.slice(0, 5).join(" / ") + (names.length > 5 ? " ほか" + (names.length - 5) + "件" : "");
    main.appendChild(nameDiv);
    main.appendChild(title);
    main.appendChild(meta);
    if (entry.title && agenda.textContent) main.appendChild(agenda);
    const ops = document.createElement("div");
    ops.className = "historyOps";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "mini";
    copy.textContent = "コピー";
    copy.addEventListener("click", async () => {
      try {
        await copyText(buildSummary(entry));
        toast("会議結果をコピーしました。");
      } catch (e) {
        toast("コピーできませんでした。");
      }
    });
    const reuse = document.createElement("button");
    reuse.type = "button";
    reuse.className = "mini";
    reuse.textContent = "再利用";
    reuse.title = "この会議の議題を設定に読み込む";
    reuse.addEventListener("click", () => {
      applyHistoryTemplate(entry);
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mini";
    del.textContent = "削除";
    del.addEventListener("click", () => {
      if (!window.confirm("この会議履歴を削除しますか？")) return;
      deleteHistoryEntry(entry.id);
      renderHistory();
      const buttons = document.querySelectorAll("#historyList .historyOps button:last-child");
      const target = buttons[Math.min(index, buttons.length - 1)];
      if (target) target.focus();
      else $("startNowBtn").focus();
    });
    ops.appendChild(copy);
    ops.appendChild(reuse);
    ops.appendChild(del);
    item.appendChild(main);
    item.appendChild(ops);
    list.appendChild(item);
  });
}

function fallbackCopy(text) {
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
    }
  });
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function renderRun(now) {
  updateSoundButton();
  const runTitle = R.title || "";
  $("meetingName").textContent = runTitle;
  $("meetingName").hidden = !runTitle;
  $("jstRunClock").textContent = fmtHMS(now);
  $("meetEndLabel").textContent = R.ended ? "終了時刻" : "会議終了";
  $("meetEnd").textContent = fmtClockRel(R.ended && R.actualEndMs ? R.actualEndMs : R.meetEndMs, now);
  const overrun = !!R.overrun;
  const waiting = now < R.actStartMs;
  $("meetLeftLabel").textContent = overrun ? "超過" : "会議の残り";
  $("meetLeft").textContent = overrun ? fmtDur(now - R.meetEndMs) : fmtDur(Math.max(0, R.meetEndMs - now));
  $("meetLeft").classList.toggle("over", overrun);
  $("finishBtn").hidden = R.ended || waiting;
  $("skipBtn").hidden = overrun || R.ended || R.idx < 0;
  $("backBtn").hidden = overrun || R.ended;
  $("extendBtn").hidden = R.ended;
  $("copyBtn").hidden = !R.ended;

  if (R.ended) {
    $("curLabel").textContent = "会議";
    $("curName").textContent = "終了";
    $("curLeft").textContent = "終了";
    $("curLeft").className = "clock endjp";
    $("curEndLabel").textContent = "会議終了";
    $("curEnd").textContent = fmtClockRel(R.actualEndMs || R.meetEndMs, now);
    $("curPrev").textContent = "開始 " + fmtClockRel(R.actStartMs, now)
      + "　／　終了 " + fmtClockRel(R.actualEndMs || R.meetEndMs, now)
      + "（予定 " + fmtClockRel(R.meetEndMs, now) + "）";
    $("curBar").style.width = "100%";
    $("nextName").textContent = "—";
    $("nextEnd").textContent = "--:--:--";
  } else if (overrun) {
    $("curLabel").textContent = "会議";
    $("curName").textContent = "超過中";
    $("curLeft").textContent = "+" + fmtDur(now - R.meetEndMs);
    $("curLeft").className = "clock over";
    $("curEndLabel").textContent = "予定終了";
    $("curEnd").textContent = fmtClockRel(R.meetEndMs, now);
    $("curPrev").textContent = "「会議を終了」を押すまで継続します";
    $("curBar").style.width = "100%";
    $("nextName").textContent = "—";
    $("nextEnd").textContent = "--:--:--";
  } else if (waiting) {
    const startLabel = fmtClockRel(R.actStartMs, now);
    let prev = "開始予定 " + fmtPlanStartLabel(R.actStartMs, now);
    if (R.startPreEnabled && !R.startPreFired) prev += "　開始前アラーム " + fmtClockRel(R.startPreMs, now);
    else if (R.startPreEnabled && R.startPreMissed) prev += "　開始前アラームは時間切れ";
    else if (R.startPreEnabled && R.startPreFired) prev += "　開始前アラーム済み";
    else prev += "　開始時刻になると自動でタイマーが進みます";
    $("curLabel").textContent = "開始待ち";
    $("curName").textContent = "MTG開始まで";
    $("curLeft").textContent = fmtDur(R.actStartMs - now);
    $("curLeft").className = "clock small";
    $("curEndLabel").textContent = "MTG開始";
    $("curEnd").textContent = startLabel;
    $("curPrev").textContent = prev;
    $("curBar").style.width = "0%";
    $("nextName").textContent = R.idx >= 0 ? R.items[R.idx].name : "—";
    $("nextEnd").textContent = R.idx >= 0 ? fmtClockRel(R.items[R.idx].endMs, now) : "--:--:--";
  } else if (R.idx >= 0) {
    const it = R.items[R.idx];
    const rem = it.endMs - now;
    const note = [];
    if (it.note) note.push(it.note);
    if (R.preEndSec > 0) {
      const preMs = it.endMs - R.preEndSec * 1000;
      if (!it.preFired && preMs > now) note.push("終了前アラーム " + fmtClockRel(preMs, now));
    }
    $("curLabel").textContent = "いまの議題";
    $("curName").textContent = it.name;
    $("curLeft").textContent = rem > 0 ? fmtDur(rem) : "0:00";
    $("curLeft").className = "clock" + (rem <= 0 ? " fin" : rem <= 30000 ? " warn" : "");
    $("curEndLabel").textContent = "この議題の終了";
    $("curEnd").textContent = fmtClockRel(it.endMs, now);
    $("curPrev").textContent = note.join("　");
    const win = Math.max(1000, it.endMs - it.anchorMs);
    const pct = Math.max(0, Math.min(100, (now - it.anchorMs) / win * 100));
    $("curBar").style.width = pct + "%";
    let nx = R.idx + 1;
    while (nx < R.items.length && R.items[nx].status !== "wait") nx++;
    $("nextName").textContent = nx < R.items.length ? R.items[nx].name : "（最後の議題です）";
    $("nextEnd").textContent = nx < R.items.length ? fmtClockRel(R.items[nx].endMs, now) : fmtClockRel(R.meetEndMs, now);
  } else {
    $("curLabel").textContent = "いまの議題";
    $("curName").textContent = "すべての議題が終了";
    $("curLeft").textContent = fmtDur(Math.max(0, R.meetEndMs - now));
    $("curLeft").className = "clock small";
    $("curEndLabel").textContent = "会議終了";
    $("curEnd").textContent = fmtClockRel(R.meetEndMs, now);
    $("curPrev").textContent = "";
    $("curBar").style.width = "100%";
    $("nextName").textContent = "—";
    $("nextEnd").textContent = "--:--:--";
  }

  const key = (R.ended ? "E" : overrun ? "O" : waiting ? "W" : "R") + "|" + R.idx + "|" + R.meetEndMs + "|" + dayIndexJst(now) + "|"
    + R.items.map((it) => it.name + ":" + it.status + ":" + it.endMs + ":" + it.note).join("|");
  if (key !== lastRenderKey) {
    lastRenderKey = key;
    const tl = $("timeline");
    tl.innerHTML = "";
    const total = Math.max(1, R.meetEndMs - R.planStartMs);
    let prevEnd = R.planStartMs;
    R.items.forEach((it) => {
      const d = Math.max(0, it.endMs - prevEnd);
      prevEnd = it.endMs;
      const seg = document.createElement("div");
      const cls = it.status === "run" ? (waiting ? "fut" : "cur") : it.status === "wait" ? "fut" : it.status === "skip" ? "skip" : "past";
      seg.className = "seg " + cls;
      seg.style.flex = "0 0 " + (d / total * 100) + "%";
      seg.title = it.name + "　終了 " + fmtClockRel(it.endMs, now) + (it.status === "skip" ? "（スキップ）" : "");
      const sp = document.createElement("span");
      sp.textContent = it.name;
      seg.appendChild(sp);
      tl.appendChild(seg);
    });
    if (R.meetEndMs - prevEnd > 500) {
      const seg = document.createElement("div");
      seg.className = "seg fut";
      seg.style.flex = "1 1 auto";
      seg.title = "割り振り外の余白";
      tl.appendChild(seg);
    }

    const body = $("runBody");
    body.innerHTML = "";
    runRowRefs = [];
    R.items.forEach((it) => {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      const b = document.createElement("b");
      const isCurrent = it.status === "run" && !waiting;
      b.textContent = it.name + (isCurrent ? "（実行中）" : "");
      td1.appendChild(b);
      if (it.note) {
        const em = document.createElement("i");
        em.style.cssText = "display:block;font-style:normal;color:var(--warn);font-size:11px";
        em.textContent = "↳ " + it.note;
        td1.appendChild(em);
      }
      const td2 = document.createElement("td");
      td2.className = "num";
      td2.textContent = fmtClockRel(it.endMs, now);
      const td3 = document.createElement("td");
      td3.className = "num";
      const td4 = document.createElement("td");
      const display = (waiting && it.status === "run") ? ["開始待ち", "wait"] : ST[it.status];
      td4.className = "st " + display[1];
      td4.textContent = display[0];
      tr.appendChild(td1);
      tr.appendChild(td2);
      tr.appendChild(td3);
      tr.appendChild(td4);
      body.appendChild(tr);
      runRowRefs.push(td3);
    });
  }

  R.items.forEach((it, i) => {
    const ref = runRowRefs[i];
    if (ref) ref.textContent = (it.status === "done" || it.status === "skip") ? "—" : fmtDur(Math.max(0, it.endMs - now));
  });

  const titlePrefix = R.title ? R.title + "｜" : "";
  document.title = titlePrefix + (R.ended
    ? "終了｜MTGタイマー"
    : overrun
      ? "超過 +" + fmtDur(now - R.meetEndMs) + "｜MTGタイマー"
      : waiting
        ? "開始待ち " + $("curLeft").textContent + "｜MTGタイマー"
        : R.idx >= 0
          ? $("curLeft").textContent + " " + R.items[R.idx].name + "｜MTGタイマー"
          : "残り " + $("curLeft").textContent + "｜MTGタイマー");
}

function refreshPlanDate() {
  const ps = parseTime($("planStart").value);
  if (ps == null) {
    $("planDateDisp").textContent = "開始予定：--";
    return;
  }
  const total = clampNum($("totalMin").value, 0, 480) * 60;
  const now = Date.now();
  const planStartMs = computePlanStartMs(ps, total, now);
  if (planStartMs == null) {
    $("planDateDisp").textContent = "開始予定：日付が不正です";
    return;
  }
  $("planDateDisp").textContent = "開始予定：" + fmtPlanStartLabel(planStartMs, now);
}

function setupClockTick() {
  $("jstSetupClock").textContent = fmtHMS(Date.now());
  if (!$("setup").hidden) updateCalc(true);
}

$("addItem").addEventListener("click", () => {
  if (rows.length >= 100) {
    toast("議題は100件までです。");
    return;
  }
  rows.push({ name: "", min: 5, sec: 0 });
  renderRows();
  const name = document.querySelector(`#agendaBody tr:nth-child(${rows.length}) input.nm`);
  if (name) name.focus();
});

$("applyTemplateBtn").addEventListener("click", () => {
  const key = $("templateSelect").value;
  const tpl = TEMPLATES[key];
  if (!tpl) {
    toast("テンプレートを選択してください。");
    return;
  }
  if (!window.confirm("現在の議題をテンプレート「" + tpl.label + "」で置き換えます。よろしいですか？")) return;
  $("totalMin").value = tpl.totalMin;
  rows.length = 0;
  tpl.rows.forEach((r) => rows.push({ name: r.name, min: r.min, sec: r.sec }));
  renderRows();
  $("templateSelect").value = "";
  toast("テンプレート「" + tpl.label + "」を適用しました。");
});

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([serializeSetup(collectSetupData())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mtg-timer-settings.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("設定をJSONで書き出しました。");
});

$("importBtn").addEventListener("click", () => {
  $("importFile").click();
});

$("importHistoryBtn").addEventListener("click", () => {
  $("importHistoryFile").click();
});

$("importHistoryFile").addEventListener("change", async () => {
  const file = $("importHistoryFile").files && $("importHistoryFile").files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) {
      toast("履歴JSONファイルが大きすぎます（1MBまで）。");
      return;
    }
    const parsed = JSON.parse(await file.text());
    const entries = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.history) ? parsed.history : null;
    if (!entries) {
      toast("履歴JSONを読み込めませんでした。");
      return;
    }
    const result = mergeHistoryEntries(entries);
    renderHistory();
    toast(result.added > 0 ? result.added + "件の会議履歴を読み込みました。" : "新しい会議履歴はありませんでした。");
  } catch (e) {
    toast("履歴JSONを読み込めませんでした。");
  } finally {
    $("importHistoryFile").value = "";
  }
});

$("importFile").addEventListener("change", async () => {
  const file = $("importFile").files && $("importFile").files[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) {
      toast("JSONファイルが大きすぎます（1MBまで）。");
      return;
    }
    const text = await file.text();
    const data = parseImportedSetup(text);
    if (!data) {
      toast("JSONを読み込めませんでした。形式を確認してください。");
      return;
    }
    applySetupData(data);
    renderRows();
    toast("設定を読み込みました。");
  } catch (e) {
    toast("JSONを読み込めませんでした。");
  } finally {
    $("importFile").value = "";
  }
});

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("installBtn").hidden = false;
});

$("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  $("installBtn").hidden = true;
  try {
    prompt.prompt();
    await prompt.userChoice;
  } catch (e) {}
});

window.addEventListener("appinstalled", () => {
  $("installBtn").hidden = true;
});


function bindNumberField(id, min, max) {
  const inp = $(id);
  inp.addEventListener("input", () => updateCalc());
  inp.addEventListener("change", () => {
    inp.value = clampNum(inp.value, min, max);
    updateCalc();
  });
}

bindNumberField("totalMin", 1, 480);
bindNumberField("preStartMin", 0, 60);
bindNumberField("preEndSec", 0, 300);
$("planStart").addEventListener("input", () => updateCalc());
$("planDate").addEventListener("input", () => updateCalc());
$("overrunMode").addEventListener("change", scheduleSaveSetup);

$("voiceTestBtn").addEventListener("click", () => {
  enableAudio();
  playSequence("preStart");
  setTimeout(() => playSequence("item"), 900);
  speak("音声テストです。開始前アラームと議題の切り替わり、会議の終了を日本語でお知らせします。");
  toast("音声を再生しました。環境によっては日本語音声が出ない場合があります。");
});

$("notifyBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    toast("このブラウザは通知に対応していません。");
    return;
  }
  try {
    const permission = await requestNotificationPermission();
    updateNotifyButton();
    toast(permission === "granted"
      ? "通知を有効にしました。タブが非表示のときも通知します。"
      : "通知が許可されませんでした。ブラウザの設定を確認してください。");
  } catch (e) {
    toast("通知を有効にできませんでした。");
  }
});

if (!document.documentElement.requestFullscreen) $("fsBtn").hidden = true;
$("fsBtn").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (e) {
    toast("全画面表示にできませんでした。");
  }
});

document.addEventListener("fullscreenchange", () => {
  $("fsBtn").textContent = document.fullscreenElement ? "全画面を終了" : "全画面";
});

$("startNowBtn").addEventListener("click", () => startRun("now"));
$("startFixedBtn").addEventListener("click", () => startRun("fixed"));
$("startPlanBtn").addEventListener("click", () => startRun("plan"));

$("finishBtn").addEventListener("click", () => {
  if (!R || R.ended || $("finishBtn").hidden) return;
  if (!window.confirm("会議を終了しますか？")) return;
  endMeeting(true);
  renderRun(Date.now());
});

$("extendMin").addEventListener("input", () => {
  if (R && !R.ended) {
    R.extendMin = clampNum($("extendMin").value, 1, 60);
    persistRun();
  }
});

$("extendMin").addEventListener("change", () => {
  const value = clampNum($("extendMin").value, 1, 60);
  $("extendMin").value = value;
  if (R && !R.ended) {
    R.extendMin = value;
    persistRun();
  }
});

$("extendBtn").addEventListener("click", () => {
  if (!R || R.ended) return;
  const now = Date.now();
  if (now < extendLockUntil) return;
  extendLockUntil = now + 500;
  const minutes = clampNum($("extendMin").value, 1, 60);
  $("extendMin").value = minutes;
  R.extendMin = minutes;
  const delta = minutes * 60000;

  if (R.overrun) {
    R.meetEndMs = Math.max(R.meetEndMs, now) + delta;
    R.overrun = false;
    R.meetPreEnabled = R.preEndSec > 0;
    R.meetPreMs = R.meetEndMs - R.preEndSec * 1000;
    R.meetPreFired = !R.meetPreEnabled || R.meetPreMs <= now;
  } else {
    R.meetEndMs += delta;
    if (R.idx >= 0) {
      const cur = R.items[R.idx];
      cur.endMs += delta;
      cur.preFired = false;
      for (let i = R.idx + 1; i < R.items.length; i++) {
        if (R.items[i].status === "wait") R.items[i].endMs += delta;
      }
    }
    const lastEndMs = R.items.length ? R.items[R.items.length - 1].endMs : R.meetEndMs;
    R.meetPreEnabled = R.preEndSec > 0 && R.meetEndMs - lastEndMs > R.preEndSec * 1000;
    R.meetPreMs = R.meetEndMs - R.preEndSec * 1000;
    R.meetPreFired = !R.meetPreEnabled || R.meetPreMs <= now;
  }

  showBanner(minutes + "分延長しました", "会議終了 " + fmtClockRel(R.meetEndMs, now), minutes + "分延長しました。会議終了は" + fmtClockRel(R.meetEndMs, now) + "です。", "start", 7000);
  speak(minutes + "分延長しました。");
  toast(minutes + "分延長しました（会議終了 " + fmtClockRel(R.meetEndMs, now) + "）");
  persistRun();
  scheduleAlarms();
  renderRun(now);
});

$("skipBtn").addEventListener("click", () => {
  if (!R || R.idx < 0 || R.ended || R.overrun) return;
  const now = Date.now();
  if (now < skipLockUntil) return;
  skipLockUntil = now + 500;
  enableAudio();
  const cur = R.items[R.idx];
  cur.status = "skip";
  cur.note = "手動スキップ（終了時刻 " + fmtClock(cur.endMs) + "）";
  playSequence("item");
  advanceToNext(now);
  autoComplete(now);
  const next = R.idx >= 0 ? R.items[R.idx] : null;
  if (next) {
    showBanner("次の内容に移ってください", "「" + next.name + "」　終了 " + fmtClockRel(next.endMs, now), "次の内容に移ってください。" + next.name, "pre", 7000);
    speak("次の内容に移ってください。" + next.name);
  } else {
    showBanner("この議題で終了です", "会議の終了時刻 " + fmtClockRel(R.meetEndMs, now) + " までもう少し続けます", "この議題で終わりです。", "pre", 7000);
    speak("この議題で終わりです。");
  }
  persistRun();
  scheduleAlarms();
  renderRun(now);
});

$("backBtn").addEventListener("click", () => {
  if (!R || R.ended || R.overrun) return;
  const now = Date.now();
  if (now < backLockUntil) return;
  backLockUntil = now + 500;
  let j = -1;
  if (R.idx >= 0) {
    for (let i = R.idx - 1; i >= 0; i--) {
      if (R.items[i].status === "done" || R.items[i].status === "skip") {
        j = i;
        break;
      }
    }
  } else {
    for (let i = R.items.length - 1; i >= 0; i--) {
      if (R.items[i].status === "done" || R.items[i].status === "skip") {
        j = i;
        break;
      }
    }
  }
  if (j < 0) {
    toast("戻れる前の議題がありません。");
    return;
  }
  enableAudio();
  const from = R.idx >= 0 ? R.items[R.idx] : null;
  const to = R.items[j];
  const endMs = from ? from.endMs : R.meetEndMs;
  to.status = "run";
  to.endMs = endMs;
  to.anchorMs = now;
  to.preFired = false;
  suppressShortPreAlarm(to);
  to.note = "再開（終了時刻 " + fmtClockRel(endMs, Date.now()) + " まで）";
  if (from) {
    from.status = "skip";
    from.note = "前の議題へ譲渡（終了時刻 " + fmtClockRel(endMs, Date.now()) + "）";
  }
  R.idx = j;
  playSequence("item");
  showBanner("前の内容に戻ります", "「" + to.name + "」　終了 " + fmtClockRel(to.endMs, now), "前の内容に戻ります。" + to.name, "pre", 7000);
  speak("前の内容に戻ります。" + to.name);
  persistRun();
  scheduleAlarms();
  renderRun(now);
});

$("soundBtn").addEventListener("click", () => {
  const wasUnlocked = isAudioUnlocked();
  if (!wasUnlocked) {
    enableAudio();
    setSoundOn(true);
    setTimeout(() => {
      updateSoundButton();
      playSequence("item");
    }, 60);
    return;
  }
  const next = !getSoundOn();
  setSoundOn(next);
  updateSoundButton();
  if (!next) cancelSpeech();
  else playSequence("item");
});

$("copyBtn").addEventListener("click", async () => {
  if (!R || !R.ended) return;
  try {
    await copyText(buildSummary(R));
    toast("会議結果をコピーしました。");
  } catch (e) {
    toast("コピーできませんでした。");
  }
});

$("clearHistoryBtn").addEventListener("click", () => {
  if (loadHistory().length === 0) return;
  if (!window.confirm("会議履歴をすべて削除しますか？")) return;
  clearHistoryData();
  renderHistory();
  $("startNowBtn").focus();
  toast("会議履歴を削除しました。");
});

function csvCell(value) {
  let text = String(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

$("exportHistoryCsvBtn").addEventListener("click", () => {
  const history = loadHistory();
  if (history.length === 0) return;
  const now = Date.now();
  const rows = [["会議名", "開始", "終了", "予定開始", "予定終了", "実際の長さ(分)", "議題数", "スキップ数", "議題一覧"]];
  history.forEach((entry) => {
    const names = entry.items.map((it) => it.name).join(" / ");
    const skipped = entry.items.filter((it) => it.status === "skip").length;
    rows.push([
      entry.title || "",
      fmtPlanStartLabel(entry.actStartMs, now),
      fmtClockRel(entry.actualEndMs, now),
      fmtPlanStartLabel(entry.planStartMs, now),
      fmtClockRel(entry.meetEndMs, now),
      (Math.max(0, entry.actualEndMs - entry.actStartMs) / 60000).toFixed(1),
      entry.items.length,
      skipped,
      names
    ]);
  });
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mtg-timer-history.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("会議履歴をCSVで書き出しました。");
});

$("exportHistoryBtn").addEventListener("click", () => {
  const history = loadHistory();
  if (history.length === 0) return;
  const blob = new Blob([JSON.stringify({
    app: "mtg-timer",
    version: 1,
    exportedAt: new Date().toISOString(),
    history: history
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mtg-timer-history.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("会議履歴をJSONで書き出しました。");
});

window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_HISTORY) renderHistory();
});

$("quitBtn").addEventListener("click", () => {
  if (R && !R.ended && !window.confirm("タイマーを終了して設定に戻りますか？")) return;
  releaseRunLock();
  R = null;
  if (tickTimer) {
    clearTimeout(tickTimer);
    tickTimer = null;
  }
  hideBanner();
  try {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  } catch (e) {}
  releaseWakeLock();
  clearScheduled();
  skipLockUntil = 0;
  backLockUntil = 0;
  extendLockUntil = 0;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  lastRenderKey = "";
  runRowRefs = [];
  clearRunData();
  $("run").hidden = true;
  $("setup").hidden = false;
  document.title = "MTGタイマー｜日本時間";
  saveSetup();
  updateCalc();
  $("startNowBtn").focus();
});

document.addEventListener("keydown", (event) => {
  if ($("run").hidden) return;
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  const tag = event.target && event.target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const key = event.key.toLowerCase();
  if (key === "n") {
    event.preventDefault();
    if (!$("skipBtn").hidden) $("skipBtn").click();
  } else if (key === "b") {
    event.preventDefault();
    if (!$("backBtn").hidden) $("backBtn").click();
  } else if (key === "e") {
    event.preventDefault();
    if (!$("extendBtn").hidden) $("extendBtn").click();
  } else if (key === "f") {
    event.preventDefault();
    if (!$("finishBtn").hidden) $("finishBtn").click();
  } else if (key === "m") {
    event.preventDefault();
    $("soundBtn").click();
  } else if (key === "q") {
    event.preventDefault();
    $("quitBtn").click();
  } else if (event.key === "?") {
    event.preventDefault();
    showBanner("キーボードショートカット", "N: 次の議題　B: 前の議題　E: 延長　F: 会議を終了　M: 音声切替　Q: 設定に戻る", "", "start", 8000);
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (R && !R.ended) {
      enableAudio();
      requestWakeLock();
      tick();
    }
  } else {
    persistRun();
  }
});

window.addEventListener("pagehide", () => {
  saveSetup();
  persistRun();
});

window.addEventListener("beforeunload", (event) => {
  saveSetup();
  persistRun();
  if (R && !R.ended) {
    event.preventDefault();
    event.returnValue = "";
  }
});

try {
  if ("speechSynthesis" in window) {
    speechSynthesis.getVoices();
    if (speechSynthesis.addEventListener) {
      speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
    }
  }
} catch (e) {}

if ("serviceWorker" in navigator && !navigator.webdriver && !location.search.includes("no-sw")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).then((registration) => {
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            toast("新しいバージョンがあります。再読み込みしてください。", 8000);
          }
        });
      });
    }).catch(() => {});
  });
}

loadSetup();
renderRows();
renderHistory();
updateNotifyButton();
setupClockTick();
setInterval(setupClockTick, 1000);
restoreRun();
