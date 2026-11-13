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
