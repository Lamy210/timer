import { TEMPLATES, loadSetupData, saveSetupData, serializeSetup, parseImportedSetup } from "./storage.js";
import { $, toast } from "./ui.js";
import { clampNum, parseTime, todToMs, dateTodToMs, resolvePlanStartMs, getFixedStartInfoFromMs, fmtClockRel, fmtDur, fmtPlanStartLabel, fmtHMS } from "./time.js";
import { buildIcsEvent } from "./ics.js";

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

function numInput(obj, key, min, max, label) {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.min = min;
  inp.max = max;
  inp.value = obj[key];
  inp.setAttribute("aria-label", label || (key === "min" ? "分" : "秒"));
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
    tdM.appendChild(numInput(r, "min", 0, 600, "議題" + (i + 1) + "の分"));
    const tdS = document.createElement("td");
    tdS.appendChild(numInput(r, "sec", 0, 59, "議題" + (i + 1) + "の秒"));

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

export function updateCalc(skipSave) {
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

let saveSetupTimer = null;

function collectSetupData() {
  return {
    planStart: $("planStart").value,
    planDate: $("planDate").value,
    meetingTitle: $("meetingTitle").value.trim().slice(0, 100),
    meetingMemo: $("meetingMemo").value.trim().slice(0, 1000),
    totalMin: clampNum($("totalMin").value, 1, 480),
    preStartMin: clampNum($("preStartMin").value, 0, 60),
    preEndSec: clampNum($("preEndSec").value, 0, 300),
    overrunMode: $("overrunMode").checked,
    rows: rows.map((r) => ({ name: r.name, min: r.min, sec: r.sec }))
  };
}

export function saveSetup() {
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
  if (data.meetingMemo !== undefined) $("meetingMemo").value = data.meetingMemo;
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

export function applyHistoryTemplate(entry) {
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
  $("meetingMemo").value = entry.memo || "";
  $("totalMin").value = String(total);
  rows.length = 0;
  nextRows.forEach((row) => rows.push(row));
  renderRows();
  toast("会議履歴から議題を読み込みました。");
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

export function setupClockTick() {
  $("jstSetupClock").textContent = fmtHMS(Date.now());
  if (!$("setup").hidden) updateCalc(true);
}

let onStart = null;

export function initSetup(options = {}) {
  onStart = typeof options.onStart === "function" ? options.onStart : null;
  const start = (mode) => {
    if (onStart) onStart(mode);
  };
  loadSetup();
  renderRows();
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

  $("exportIcsBtn").addEventListener("click", () => {
    const data = collectSetupData();
    const ps = parseTime(data.planStart);
    if (ps == null) {
      toast("MTG開始時刻を入力してください。");
      return;
    }
    const now = Date.now();
    const totalSec = data.totalMin * 60;
    let planStartMs;
    if (data.planDate) {
      planStartMs = dateTodToMs(data.planDate, ps);
      if (planStartMs == null) {
        toast("開催日が不正です。日付を確認してください。");
        return;
      }
    } else {
      planStartMs = resolvePlanStartMs(ps, totalSec, now);
    }
    const ics = buildIcsEvent({
      title: data.meetingTitle,
      memo: data.meetingMemo,
      agenda: data.rows,
      startMs: planStartMs,
      endMs: planStartMs + totalSec * 1000,
      now
    });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mtg-timer.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("カレンダー用ファイルを書き出しました。");
  });

  $("importBtn").addEventListener("click", () => {
    $("importFile").click();
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
  $("meetingMemo").addEventListener("input", scheduleSaveSetup);

  $("startNowBtn").addEventListener("click", () => start("now"));
  $("startFixedBtn").addEventListener("click", () => start("fixed"));
  $("startPlanBtn").addEventListener("click", () => start("plan"));
}

export function getRows() {
  return rows;
}
