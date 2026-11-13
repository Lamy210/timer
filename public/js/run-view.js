import { $ } from "./ui.js";
import { getSoundOn, isAudioUnlocked } from "./alerts.js";
import { ST } from "./result.js";
import { fmtHMS, fmtClockRel, fmtPlanStartLabel, fmtDur, dayIndexJst } from "./time.js";

let lastRenderKey = "";
let runRowRefs = [];

export function resetRunView() {
  lastRenderKey = "";
  runRowRefs = [];
}

export function updateSoundButton() {
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

export function renderRun(run, now) {
  const R = run;
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

