import { fmtClockRel, fmtDur } from "./time.js";

export const ST = {
  done: ["済", "done"],
  run: ["実行中", "run"],
  wait: ["待機", "wait"],
  skip: ["スキップ", "skipc"]
};

export function buildSummary(run) {
  const now = Date.now();
  const actualEnd = run.actualEndMs || run.meetEndMs;
  const lines = [
    "MTGタイマー結果",
    ...(run.title ? ["会議名: " + run.title] : []),
    ...(run.memo ? ["メモ: " + run.memo] : []),
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
