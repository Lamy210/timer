import { $, toast, copyText } from "./ui.js";
import { fmtClockRel, fmtPlanStartLabel, fmtDur } from "./time.js";
import { STORAGE_HISTORY, loadHistory, deleteHistoryEntry, clearHistoryData, mergeHistoryEntries } from "./storage.js";
import { buildSummary } from "./result.js";

const HISTORY_STATUS = {
  done: "完了",
  skip: "スキップ",
  run: "実行中",
  wait: "待機"
};

let applyTemplate = null;
let historyQuery = "";

export function csvCell(value) {
  let text = String(value == null ? "" : value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

export function historySummaryText(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  let totalActual = 0;
  let totalOverrun = 0;
  let skipped = 0;
  history.forEach((entry) => {
    totalActual += Math.max(0, entry.actualEndMs - entry.actStartMs);
    totalOverrun += entry.actualEndMs - entry.meetEndMs;
    skipped += (entry.items || []).filter((it) => it.status === "skip").length;
  });
  const avgActual = Math.round(totalActual / history.length / 60000);
  const avgOverrun = Math.round(totalOverrun / history.length / 60000);
  const overrunText = avgOverrun === 0
    ? "平均超過 ±0分"
    : avgOverrun > 0
      ? "平均超過 +" + avgOverrun + "分"
      : "平均不足 " + Math.abs(avgOverrun) + "分";
  return "履歴" + history.length + "件　／　平均実績 " + avgActual + "分　／　" + overrunText
    + (skipped > 0 ? "　／　スキップ " + skipped + "件" : "");
}

export function historyCsvRows(history, now, fmtPlanStartLabel, fmtClockRel) {
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
  return rows;
}

export function initHistory(options = {}) {
  applyTemplate = typeof options.onApplyTemplate === "function" ? options.onApplyTemplate : null;

  $("historySearch").addEventListener("input", () => {
    historyQuery = $("historySearch").value.trim().toLowerCase();
    renderHistory();
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

  $("clearHistoryBtn").addEventListener("click", () => {
    if (loadHistory().length === 0) return;
    if (!window.confirm("会議履歴をすべて削除しますか？")) return;
    clearHistoryData();
    renderHistory();
    $("startNowBtn").focus();
    toast("会議履歴を削除しました。");
  });

  $("exportHistoryCsvBtn").addEventListener("click", () => {
    const history = loadHistory();
    if (history.length === 0) return;
    const now = Date.now();
    const rows = historyCsvRows(history, now, fmtPlanStartLabel, fmtClockRel);
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
}

export function renderHistory() {
  const card = $("historyCard");
  const list = $("historyList");
  if (!card || !list) return;
  const all = loadHistory();
  const history = historyQuery
    ? all.filter((entry) => {
      const haystack = [entry.title, ...entry.items.map((it) => it.name), ...entry.items.map((it) => it.note)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(historyQuery);
    })
    : all;
  const summary = $("historySummary");
  if (summary) summary.textContent = historySummaryText(all) + (historyQuery ? "　／　表示 " + history.length + "件" : "");
  card.hidden = all.length === 0;
  list.innerHTML = "";
  const now = Date.now();
  if (historyQuery && history.length === 0) {
    const empty = document.createElement("div");
    empty.className = "historyEmpty";
    empty.textContent = "該当する履歴がありません。";
    list.appendChild(empty);
    return;
  }
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
    const detail = document.createElement("div");
    detail.className = "historyDetail";
    detail.id = "historyDetail-" + index;
    detail.hidden = true;
    const detailSummary = document.createElement("div");
    detailSummary.textContent = "予定 " + fmtClockRel(entry.planStartMs, now) + " 〜 " + fmtClockRel(entry.meetEndMs, now)
      + "　／　実績 " + fmtClockRel(entry.actStartMs, now) + " 〜 " + fmtClockRel(entry.actualEndMs, now);
    detail.appendChild(detailSummary);
    if (entry.memo) {
      const memo = document.createElement("div");
      memo.className = "historyMemo";
      memo.textContent = entry.memo;
      detail.appendChild(memo);
    }
    const detailList = document.createElement("ul");
    entry.items.forEach((it) => {
      const li = document.createElement("li");
      const name = document.createElement("b");
      name.textContent = it.name || "（無題の議題）";
      li.appendChild(name);
      li.appendChild(document.createTextNode("　終了 " + fmtClockRel(it.endMs, now)
        + "　" + (HISTORY_STATUS[it.status] || it.status)
        + (it.note ? "　" + it.note : "")));
      detailList.appendChild(li);
    });
    detail.appendChild(detailList);

    const ops = document.createElement("div");
    ops.className = "historyOps";
    const detailBtn = document.createElement("button");
    detailBtn.type = "button";
    detailBtn.className = "mini";
    detailBtn.textContent = "詳細";
    detailBtn.setAttribute("aria-expanded", "false");
    detailBtn.setAttribute("aria-controls", detail.id);
    detailBtn.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      detailBtn.setAttribute("aria-expanded", String(!detail.hidden));
    });
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
      if (applyTemplate) applyTemplate(entry);
      else toast("再利用できません。");
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
    ops.appendChild(detailBtn);
    ops.appendChild(copy);
    ops.appendChild(reuse);
    ops.appendChild(del);
    item.appendChild(main);
    item.appendChild(ops);
    item.appendChild(detail);
    list.appendChild(item);
  });
}
