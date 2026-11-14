import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, historySummaryText, historyCsvRows } from "../../public/js/history.js";

test("csvCell neutralizes formula prefixes and quotes CSV fields", () => {
  assert.equal(csvCell('=1+1,"x"'), '"\'=1+1,""x"""');
  assert.equal(csvCell("+1"), "'+1");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("a\nb"), '"a\nb"');
  assert.equal(csvCell(null), "");
});

test("historySummaryText reports count, average, overrun, and skips", () => {
  const history = [
    { actualEndMs: 600000, actStartMs: 0, meetEndMs: 600000, items: [{ status: "skip" }] },
    { actualEndMs: 720000, actStartMs: 0, meetEndMs: 600000, items: [{ status: "skip" }] }
  ];
  assert.equal(
    historySummaryText(history),
    "履歴2件　／　平均実績 11分　／　平均超過 +1分　／　スキップ 2件"
  );
  assert.equal(historySummaryText([]), "");
});

test("historySummaryText distinguishes early finishes", () => {
  const text = historySummaryText([
    { actualEndMs: 540000, actStartMs: 0, meetEndMs: 600000, items: [] }
  ]);
  assert.match(text, /平均不足 1分/);
  assert.doesNotMatch(text, /スキップ/);
});

test("historyCsvRows builds the header and formatted rows", () => {
  const rows = historyCsvRows([{
    title: "=T",
    actStartMs: 1,
    actualEndMs: 600001,
    planStartMs: 0,
    meetEndMs: 600000,
    items: [{ name: "A", status: "skip" }, { name: "B", status: "done" }],
    memo: "メモ"
  }], 0, (ms) => "P" + ms, (ms) => "C" + ms);
  assert.deepEqual(rows[0], ["会議名", "開始", "終了", "予定開始", "予定終了", "実際の長さ(分)", "議題数", "スキップ数", "議題一覧", "メモ"]);
  assert.deepEqual(rows[1], ["=T", "P1", "C600001", "P0", "C600000", "10.0", 2, 1, "A / B", "メモ"]);
});
