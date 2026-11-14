import { loadRunData, saveRunData, clearRunData, saveHistoryEntry } from "./storage.js";
import { getSoundOn, setSoundOn, isAudioUnlocked, unlockAudio, playSequence, clearScheduled, speak, cancelSpeech, notify, vibrateSequence } from "./alerts.js";
import { jstParts, fmtHMS, fmtClock, dayIndexJst, fmtClockRel, fmtPlanStartLabel, resolvePlanStartMs, getFixedStartInfoFromMs, dateTodToMs, fmtDur, remainSpeech, parseTime, clampNum } from "./time.js";
import { $, toast, copyText } from "./ui.js";
import { buildSummary } from "./result.js";
import { renderHistory } from "./history.js";
import { getRows, saveSetup, updateCalc } from "./setup.js";
import { buildItems, createRun, hydrateRun, autoComplete, resetBeepFlags, extendRun, skipCurrent, goBack } from "./run-state.js";
import { renderRun, resetRunView, updateSoundButton } from "./run-view.js";
import { requestWakeLock, releaseWakeLock, scheduleAlarms } from "./run-alarms.js";

let R = null;
let tickTimer = null;
let bannerTimer = null;
let skipLockUntil = 0;
let backLockUntil = 0;
let extendLockUntil = 0;
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

function persistRun() {
  saveRunData(R);
}

export async function restoreRun() {
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
    R = hydrateRun(saved, now, overrunMode);
    $("extendMin").value = R.extendMin;
    skipLockUntil = 0;
    backLockUntil = 0;
    extendLockUntil = 0;
    resetRunView();
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

function enableAudio() {
  unlockAudio(() => {
    updateSoundButton();
    scheduleAlarms(R);
  });
}

export async function startRun(mode) {
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
  const meetingMemo = $("meetingMemo").value.trim().slice(0, 1000);
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

  const built = buildItems(getRows(), planStartMs);
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
  const created = createRun({
    title: meetingTitle,
    memo: meetingMemo,
    extendMin,
    planStartMs,
    actStartMs,
    meetEndMs,
    preEndSec,
    overrunMode,
    items: built.items,
    mode,
    preStartMin,
    now
  });
  R = created.run;
  const skipped = created.skipped;
  skipLockUntil = 0;
  backLockUntil = 0;
  extendLockUntil = 0;
  resetRunView();

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
  scheduleAlarms(R);

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
  showBanner("終 了", (manual ? "会議を終了しました" : "会議の終了時刻です") + "（日本時間 " + fmtClockRel(endMs, Date.now()) + "）", "終了", "endj", 12000);
}

function showShortcuts() {
  showBanner("キーボードショートカット", "N: 次の議題　B: 前の議題　E: 延長　F: 会議を終了　M: 音声切替　Q: 設定に戻る", "", "start", 8000);
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
  notify("終了時刻を超過", "会議を終了するには「会議を終了」を押してください。", {
    tag: "mtg-timer-overrun",
    requireInteraction: true,
    actions: [
      { action: "extend5", title: "5分延長" },
      { action: "finish", title: "会議を終了" }
    ]
  });
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
        autoComplete(R, now);
        enterOverrun();
      } else {
        endMeeting(false);
      }
    } else if (now >= R.actStartMs) {
      const result = autoComplete(R, now);
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

  renderRun(R, now);
  tickTimer = setTimeout(tick, R.ended ? 1000 : 250);
}

function recordHistory() {
  if (!R) return;
  saveHistoryEntry({
    id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8),
    title: R.title || "",
    memo: R.memo || "",
    planStartMs: R.planStartMs,
    actStartMs: R.actStartMs,
    meetEndMs: R.meetEndMs,
    actualEndMs: R.actualEndMs || R.meetEndMs,
    items: R.items.map((it) => ({ name: it.name, status: it.status, endMs: it.endMs, note: it.note }))
  });
  renderHistory();
}

function handleNotificationAction(action) {
  if (!R || R.ended) return;
  if (action === "extend5") {
    $("extendMin").value = "5";
    $("extendBtn").click();
  } else if (action === "finish") {
    endMeeting(true);
    renderRun(R, Date.now());
  }
}


export function initRun() {
  $("helpBtn").addEventListener("click", showShortcuts);

  $("voiceTestBtn").addEventListener("click", () => {
    enableAudio();
    playSequence("preStart");
    setTimeout(() => playSequence("item"), 900);
    speak("音声テストです。開始前アラームと議題の切り替わり、会議の終了を日本語でお知らせします。");
    toast("音声を再生しました。環境によっては日本語音声が出ない場合があります。");
  });

  $("finishBtn").addEventListener("click", () => {
    if (!R || R.ended || $("finishBtn").hidden) return;
    if (!window.confirm("会議を終了しますか？")) return;
    endMeeting(true);
    renderRun(R, Date.now());
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
    extendRun(R, minutes, now);

    showBanner(minutes + "分延長しました", "会議終了 " + fmtClockRel(R.meetEndMs, now), minutes + "分延長しました。会議終了は" + fmtClockRel(R.meetEndMs, now) + "です。", "start", 7000);
    speak(minutes + "分延長しました。");
    toast(minutes + "分延長しました（会議終了 " + fmtClockRel(R.meetEndMs, now) + "）");
    persistRun();
    scheduleAlarms(R);
    renderRun(R, now);
  });

  $("skipBtn").addEventListener("click", () => {
    if (!R || R.idx < 0 || R.ended || R.overrun) return;
    const now = Date.now();
    if (now < skipLockUntil) return;
    skipLockUntil = now + 500;
    enableAudio();
    const cur = R.items[R.idx];
    const { next } = skipCurrent(R, now);
    cur.note = "手動スキップ（終了時刻 " + fmtClock(cur.endMs) + "）";
    playSequence("item");
    if (next) {
      showBanner("次の内容に移ってください", "「" + next.name + "」　終了 " + fmtClockRel(next.endMs, now), "次の内容に移ってください。" + next.name, "pre", 7000);
      speak("次の内容に移ってください。" + next.name);
    } else {
      showBanner("この議題で終了です", "会議の終了時刻 " + fmtClockRel(R.meetEndMs, now) + " までもう少し続けます", "この議題で終わりです。", "pre", 7000);
      speak("この議題で終わりです。");
    }
    persistRun();
    scheduleAlarms(R);
    renderRun(R, now);
  });

  $("backBtn").addEventListener("click", () => {
    if (!R || R.ended || R.overrun) return;
    const now = Date.now();
    if (now < backLockUntil) return;
    backLockUntil = now + 500;
    const result = goBack(R, now);
    if (!result) {
      toast("戻れる前の議題がありません。");
      return;
    }
    enableAudio();
    const { from, to, endMs } = result;
    to.note = "再開（終了時刻 " + fmtClockRel(endMs, Date.now()) + " まで）";
    if (from) {
      from.note = "前の議題へ譲渡（終了時刻 " + fmtClockRel(endMs, Date.now()) + "）";
    }
    playSequence("item");
    showBanner("前の内容に戻ります", "「" + to.name + "」　終了 " + fmtClockRel(to.endMs, now), "前の内容に戻ります。" + to.name, "pre", 7000);
    speak("前の内容に戻ります。" + to.name);
    persistRun();
    scheduleAlarms(R);
    renderRun(R, now);
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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.type !== "notification-action") return;
      handleNotificationAction(data.action);
    });
  }

  $("endQuitBtn").addEventListener("click", () => $("quitBtn").click());

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
    resetRunView();
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
      showShortcuts();
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

}
