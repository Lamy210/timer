import { test, expect } from "@playwright/test";
import fs from "node:fs";

const fakeNow = new Date("2026-11-12T01:00:00Z");

async function setupPage(page, options = {}) {
  const fakeClock = options.fakeClock !== false;
  const clockTime = options.clockTime || fakeNow;
  const errors = [];

  page.on("dialog", (dialog) => dialog.accept().catch(() => {}));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon/i.test(msg.text())) errors.push("console: " + msg.text());
  });
  page.on("pageerror", (err) => errors.push("pageerror: " + err.message));

  await page.addInitScript(() => {
    window.__spoken = [];
    window.__beeps = 0;
    window.__vibrations = [];
    window.__notifications = [];
    window.__forceHidden = false;

    class FakeAudioContext {
      constructor() {
        this.state = "running";
        this.currentTime = 0;
        this.destination = {};
      }
      resume() {
        return Promise.resolve();
      }
      createOscillator() {
        return {
          type: "",
          frequency: { value: 0 },
          connect() {},
          disconnect() {},
          start(when) { window.__beeps++; (window.__startTimes || (window.__startTimes = [])).push(when); },
          stop() {}
        };
      }
      createGain() {
        return {
          gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} },
          connect() {},
          disconnect() {}
        };
      }
    }

    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;

    const fakeSpeech = {
      getVoices() { return [{ lang: "ja-JP", name: "Fake Japanese" }]; },
      cancel() {},
      speak(utterance) { window.__spoken.push(utterance.text); }
    };
    Object.defineProperty(window, "speechSynthesis", { value: fakeSpeech, configurable: true });
    window.SpeechSynthesisUtterance = class {
      constructor(text) { this.text = text; }
    };

    class FakeNotification {
      constructor(title, options) { window.__notifications.push({ title, options }); }
    }
    FakeNotification.permission = "default";
    FakeNotification.requestPermission = async function () {
      FakeNotification.permission = "granted";
      return "granted";
    };
    window.Notification = FakeNotification;

    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get() { return window.__forceHidden ? "hidden" : "visible"; }
    });

    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern) => { window.__vibrations.push(pattern); return true; }
    });

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => { window.__copiedText = text; }
      }
    });
  });

  if (fakeClock) await page.clock.install({ time: clockTime });
  await page.goto("/?no-sw=1");
  return errors;
}

async function makeSingleAgenda(page, name, min, sec) {
  const rows = page.locator("#agendaBody tr");
  while (await rows.count() > 1) {
    const count = await rows.count();
    await page.locator(`#agendaBody tr:nth-child(${count}) td:nth-child(5) button`).last().click();
  }
  await page.locator("#agendaBody tr:nth-child(1) td:nth-child(1) input").fill(name);
  await page.locator("#agendaBody tr:nth-child(1) td:nth-child(2) input").fill(String(min));
  await page.locator("#agendaBody tr:nth-child(1) td:nth-child(3) input").fill(String(sec));
}

async function statuses(page) {
  return page.locator("#runBody tr").evaluateAll((trs) => trs.map((tr) => tr.children[3].textContent));
}

test.describe("MTG timer", () => {
  test("start now, pre-end alarm, agenda end, overrun, and finish", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#totalMin", "1");
    await page.fill("#preEndSec", "2");
    await makeSingleAgenda(page, "テスト議題", 0, 4);
    await page.click("#startNowBtn");

    await expect(page.locator("#run")).toBeVisible();
    await expect(page.locator("#curName")).toHaveText("テスト議題");
    await expect(page.locator("#bTitle")).toContainText("MTG開始");
    expect(await page.evaluate(() => window.__spoken.join("\n"))).toContain("MTGを開始します");
    expect(await page.evaluate(() => window.__vibrations.length > 0)).toBe(true);

    await page.clock.fastForward(2200);
    await expect(page.locator("#bTitle")).toContainText("まもなく終了");
    expect(await page.evaluate(() => window.__spoken.join("\n"))).toContain("まもなく「テスト議題」が終了します");

    await page.clock.fastForward(2000);
    await expect(page.locator("#curName")).toHaveText("すべての議題が終了");
    await expect(page.locator("#bTitle")).toContainText("議題はすべて終了");

    await page.clock.fastForward(56000);
    await expect(page.locator("#curName")).toHaveText("超過中");
    await expect(page.locator("#bTitle")).toContainText("終了時刻を超過");
    await expect(page.locator("#meetLeftLabel")).toHaveText("超過");
    await expect(page.locator("#finishBtn")).toBeVisible();
    await expect(page.locator("#skipBtn")).toBeHidden();
    await expect(page.locator("#extendBtn")).toBeEnabled();

    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    await expect(page.locator("#bTitle")).toContainText(/終\s*了/);
    await expect(page).toHaveTitle("終了｜MTGタイマー");
    expect(errors).toEqual([]);
  });

  test("future alarms are pre-scheduled with Web Audio", async ({ page }) => {
    const errors = await setupPage(page);
    await page.click("#startNowBtn");
    await page.waitForTimeout(50);
    const startTimes = await page.evaluate(() => window.__startTimes || []);
    expect(startTimes.some((time) => time > 0.5)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("scheduled start with pre-start alarm", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planStart", "10:02:00");
    await page.fill("#totalMin", "1");
    await page.fill("#preStartMin", "1");
    await page.fill("#preEndSec", "0");
    await makeSingleAgenda(page, "開始テスト", 0, 30);
    await page.click("#startPlanBtn");

    await expect(page.locator("#curName")).toHaveText("MTG開始まで");
    await expect(page.locator("#curLeft")).toHaveText(/^(2:00|1:59)$/);
    await expect(page.locator("#curEndLabel")).toHaveText("MTG開始");
    await expect(page.locator("#curPrev")).toContainText("開始予定 本日");

    await page.clock.fastForward(60000);
    await expect(page.locator("#bTitle")).toContainText("まもなくMTG開始");
    expect(await page.evaluate(() => window.__spoken.join("\n"))).toContain("まもなくMTGが始まります");

    await page.clock.fastForward(60000);
    await expect(page.locator("#curName")).toHaveText("開始テスト");
    await expect(page.locator("#bTitle")).toContainText("MTG開始");
    expect(await page.evaluate(() => window.__spoken.join("\n"))).toContain("最初の議題は「開始テスト」です");
    expect(errors).toEqual([]);
  });

  test("late scheduled start skips overdue agendas", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planStart", "09:58:00");
    await page.fill("#totalMin", "30");
    await page.click("#startPlanBtn");

    await expect(page.locator("#curName")).toContainText("議題1：報告");
    await expect(page.locator("#runBody tr:nth-child(1) td:nth-child(4)")).toHaveText("スキップ");
    await expect(page.locator("#runBody tr:nth-child(1)")).toContainText("開始遅延のためスキップ");
    await expect(page.locator("#runBody tr:nth-child(2) td:nth-child(4)")).toHaveText("実行中");
    await expect(page.locator("#runBody tr:nth-child(1) td:nth-child(2)")).toHaveText("9:59:00");
    expect(errors).toEqual([]);
  });

  test("invalid agenda total is blocked", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#totalMin", "1");
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeHidden();
    await expect(page.locator("#toast")).toContainText("割り振り合計が会議の長さを超えています");
    expect(errors).toEqual([]);
  });

  test("banner does not block header controls", async ({ page }) => {
    const errors = await setupPage(page);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById("banner")).pointerEvents)).toBe("none");
    await page.click("#startNowBtn");
    await page.click("#soundBtn");
    expect(await page.evaluate(() => window.__beeps > 0)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("double-click skip only skips one agenda", async ({ page }) => {
    const errors = await setupPage(page);
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await page.dblclick("#skipBtn");
    const result = await statuses(page);
    expect(result[0]).toBe("スキップ");
    expect(result[1]).toBe("実行中");
    await expect(page.locator("#curName")).toContainText("議題1：報告");
    expect(errors).toEqual([]);
  });

  test("agenda rows can be reordered", async ({ page }) => {
    const errors = await setupPage(page);
    const first = page.locator("#agendaBody tr:nth-child(1) td:nth-child(1) input");
    await expect(first).toHaveValue("挨拶・議題確認");
    await page.locator("#agendaBody tr:nth-child(1) td:nth-child(5) button[title=\"下へ移動\"]").click();
    await expect(page.locator("#agendaBody tr:nth-child(1) td:nth-child(1) input")).toHaveValue("議題1：報告");
    await expect(page.locator("#agendaBody tr:nth-child(2) td:nth-child(1) input")).toHaveValue("挨拶・議題確認");
    await page.locator("#agendaBody tr:nth-child(2) td:nth-child(5) button[title=\"上へ移動\"]").click();
    await expect(first).toHaveValue("挨拶・議題確認");
    expect(errors).toEqual([]);
  });

  test("number inputs normalize to clamped values", async ({ page }) => {
    const errors = await setupPage(page);
    const minutes = page.locator("#agendaBody tr:nth-child(1) td:nth-child(2) input");
    await minutes.fill("999");
    await page.locator("#planStart").click();
    await expect(minutes).toHaveValue("600");
    await expect(page.locator("#agendaBody tr:nth-child(1) td:nth-child(4)")).toHaveText("20:00:00");

    await page.fill("#totalMin", "1000");
    await page.locator("#planStart").click();
    await expect(page.locator("#totalMin")).toHaveValue("480");
    expect(errors).toEqual([]);
  });

  test("waiting state and start label are correct", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planStart", "10:02:00");
    await page.fill("#totalMin", "30");
    await page.click("#startPlanBtn");
    await expect(page.locator("#run")).toBeVisible();
    expect((await statuses(page))[0]).toBe("開始待ち");
    await expect(page.locator("#curEndLabel")).toHaveText("MTG開始");
    await expect(page.locator("#curPrev")).toContainText("開始予定 本日");
    expect(errors).toEqual([]);
  });

  test("missed pre-start alarm is explained", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planStart", "10:02:00");
    await page.fill("#totalMin", "30");
    await page.fill("#preStartMin", "5");
    await page.click("#startPlanBtn");
    await expect(page.locator("#curPrev")).toContainText("開始前アラームは時間切れ");
    expect(errors).toEqual([]);
  });

  test("next-day scheduling is clearly indicated", async ({ page }) => {
    const errors = await setupPage(page, { clockTime: new Date("2026-11-12T11:00:00Z") });
    await page.fill("#planStart", "10:00:00");
    await page.fill("#totalMin", "30");
    await expect(page.locator("#planDateDisp")).toContainText("翌日");
    await page.click("#startPlanBtn");
    await expect(page.locator("#toast")).toContainText("開始予定は 翌日");
    await expect(page.locator("#curPrev")).toContainText("開始予定 翌日");
    await expect(page.locator("#curEnd")).toContainText("翌 10:00:00");
    expect(errors).toEqual([]);
  });

  test("short agenda does not fire an immediate pre-end alarm", async ({ page }) => {
    const errors = await setupPage(page);
    await makeSingleAgenda(page, "短い議題", 0, 5);
    await page.fill("#totalMin", "1");
    await page.fill("#preEndSec", "30");
    await page.click("#startNowBtn");
    await page.clock.fastForward(300);
    await expect(page.locator("#bTitle")).toHaveText("MTG開始");
    await page.clock.fastForward(5000);
    await expect(page.locator("#bTitle")).toContainText("議題はすべて終了");
    expect(errors).toEqual([]);
  });

  test("skipped agenda stays skipped after overrun and finish", async ({ page }) => {
    const errors = await setupPage(page);
    await makeSingleAgenda(page, "スキップ確認", 0, 10);
    await page.fill("#totalMin", "1");
    await page.click("#startNowBtn");
    await page.click("#skipBtn");
    await page.clock.fastForward(61000);
    expect((await statuses(page))[0]).toBe("スキップ");
    await expect(page.locator("#curEndLabel")).toHaveText("予定終了");
    await page.click("#finishBtn");
    expect((await statuses(page))[0]).toBe("スキップ");
    await expect(page.locator("#curEndLabel")).toHaveText("会議終了");
    expect(errors).toEqual([]);
  });

  test("back works after all agendas are done", async ({ page }) => {
    const errors = await setupPage(page);
    await makeSingleAgenda(page, "戻る確認", 0, 1);
    await page.fill("#totalMin", "1");
    await page.click("#startNowBtn");
    await page.clock.fastForward(1500);
    await expect(page.locator("#curName")).toHaveText("すべての議題が終了");
    await page.click("#backBtn");
    await expect(page.locator("#curName")).toHaveText("戻る確認");
    await expect(page.locator("#curEndLabel")).toHaveText("この議題の終了");
    await expect(page.locator("#runBody tr:nth-child(1) td:nth-child(4)")).toHaveText("実行中");
    expect(errors).toEqual([]);
  });

  test("run state restores after reload and audio can be re-enabled", async ({ page }) => {
    const errors = await setupPage(page, { fakeClock: false });
    await makeSingleAgenda(page, "復元確認", 0, 30);
    await page.fill("#totalMin", "1");
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    expect(await page.evaluate(() => !!sessionStorage.getItem("mtgTimer.run.v1"))).toBe(true);
    await page.fill("#extendMin", "10");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(200);
    await expect(page.locator("#run")).toBeVisible();
    await expect(page.locator("#curName")).toHaveText("復元確認");
    await expect(page.locator("#extendMin")).toHaveValue("10");
    await expect(page.locator("#soundBtn")).toHaveText("音声を有効化");
    await page.click("#soundBtn");
    await page.waitForTimeout(150);
    await expect(page.locator("#soundBtn")).toHaveText("音声あり");
    expect(errors).toEqual([]);
  });

  test("overrun-off keeps the original hard stop", async ({ page }) => {
    const errors = await setupPage(page);
    await page.uncheck("#overrunMode");
    await page.click("#startNowBtn");
    await page.clock.fastForward(61 * 60 * 1000);
    await expect(page.locator("#curName")).toHaveText("終了");
    await expect(page.locator("#finishBtn")).toBeHidden();
    await expect(page).toHaveTitle("終了｜MTGタイマー");
    expect(errors).toEqual([]);
  });

  test("+5 minutes recovers from overrun and can finish", async ({ page }) => {
    const errors = await setupPage(page);
    await page.click("#startNowBtn");
    await page.clock.fastForward(31 * 60 * 1000);
    await expect(page.locator("#curName")).toHaveText("超過中");
    await page.click("#extendBtn");
    await expect(page.locator("#curName")).toHaveText("すべての議題が終了");
    await expect(page.locator("#curLeft")).toHaveText(/^(5:00|4:59)$/);
    await expect(page.locator("#meetEnd")).toHaveText("10:36:00");
    await expect(page.locator("#finishBtn")).toBeVisible();
    await page.clock.fastForward(5 * 60 * 1000 + 1000);
    await expect(page.locator("#curName")).toHaveText("超過中");
    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    expect(errors).toEqual([]);
  });

  test("finish button also works after all agendas are done", async ({ page }) => {
    const errors = await setupPage(page);
    await makeSingleAgenda(page, "早期終了", 0, 1);
    await page.fill("#totalMin", "1");
    await page.click("#startNowBtn");
    await page.clock.fastForward(1500);
    await expect(page.locator("#curName")).toHaveText("すべての議題が終了");
    await expect(page.locator("#finishBtn")).toBeVisible();
    await expect(page.locator("#skipBtn")).toBeHidden();
    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    await expect(page).toHaveTitle("終了｜MTGタイマー");
    expect(errors).toEqual([]);
  });

  test("custom extension minutes are applied", async ({ page }) => {
    const errors = await setupPage(page);
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await page.fill("#extendMin", "10");
    await page.click("#extendBtn");
    await expect(page.locator("#meetEnd")).toHaveText("10:40:00");
    await expect(page.locator("#bTitle")).toContainText("10分延長しました");
    expect(errors).toEqual([]);
  });

  test("finish ends the meeting from a running agenda", async ({ page }) => {
    const errors = await setupPage(page);
    await page.click("#startNowBtn");
    await expect(page.locator("#finishBtn")).toBeVisible();
    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    await expect(page.locator("#curEndLabel")).toHaveText("会議終了");
    await expect(page.locator("#curEnd")).toHaveText("10:00:00");
    await expect(page.locator("#meetEndLabel")).toHaveText("終了時刻");
    await expect(page.locator("#curPrev")).toContainText("開始 10:00:00");
    await expect(page.locator("#curPrev")).toContainText("予定 10:30:00");
    await expect(page.locator("#copyBtn")).toBeVisible();
    await page.click("#copyBtn");
    await page.waitForTimeout(50);
    const copied = await page.evaluate(() => window.__copiedText || "");
    expect(copied).toContain("MTGタイマー結果");
    expect(copied).toContain("挨拶・議題確認");
    expect(copied).toContain("開始: 10:00:00");
    expect(errors).toEqual([]);
  });

  test("end screen shows a meeting summary", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#totalMin", "1");
    await makeSingleAgenda(page, "まとめ", 0, 10);
    await page.click("#startNowBtn");
    await expect(page.locator("#endSummary")).toBeHidden();
    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    await expect(page.locator("#endSummary")).toBeVisible();
    await expect(page.locator("#endSummary")).toContainText("予定 1:00");
    await expect(page.locator("#endSummary")).toContainText("実績 0:00");
    await expect(page.locator("#endSummary")).toContainText("議題 1件（完了1・スキップ0）");
    await expect(page.locator("#endSummary")).toContainText(/（-[01]:[0-5]\d）/);
    expect(errors).toEqual([]);
  });

  test("+5 minutes extends the current and future schedule", async ({ page }) => {
    const errors = await setupPage(page);
    await page.click("#startNowBtn");
    await page.clock.fastForward(25 * 60 * 1000);
    await page.click("#extendBtn");
    await expect(page.locator("#meetEnd")).toHaveText("10:35:00");
    await expect(page.locator("#curEnd")).toHaveText("10:35:00");
    await expect(page.locator("#finishBtn")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("start-now-with-fixed-end supports an early start", async ({ page }) => {
    const errors = await setupPage(page, { clockTime: new Date("2026-11-12T00:59:00Z") });
    await page.fill("#totalMin", "30");
    await expect(page.locator("#startFixedBtn")).toBeEnabled();
    await page.click("#startFixedBtn");
    await expect(page.locator("#curName")).toContainText("挨拶・議題確認");
    await expect(page.locator("#meetEnd")).toHaveText("10:30:00");
    await expect(page.locator("#toast")).toContainText("早く開始します。終了時刻は予定どおり");
    expect(errors).toEqual([]);
  });

  test("large early start asks for confirmation", async ({ page }) => {
    const errors = await setupPage(page, { clockTime: new Date("2026-11-11T23:00:00Z") });
    await page.fill("#totalMin", "30");
    await expect(page.locator("#startFixedBtn")).toBeEnabled();
    await page.click("#startFixedBtn");
    await expect(page.locator("#run")).toBeVisible();
    await expect(page.locator("#meetEnd")).toHaveText("10:30:00");
    await expect(page.locator("#toast")).toContainText("早く開始します");
    expect(errors).toEqual([]);
  });

  test("explicit future date is honored", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planDate", "2026-11-20");
    await page.fill("#planStart", "10:00:00");
    await page.fill("#totalMin", "30");
    await expect(page.locator("#planDateDisp")).toContainText("8日後");
    await expect(page.locator("#planDateDisp")).toContainText("11/20");
    await expect(page.locator("#startFixedBtn")).toBeDisabled();
    await page.click("#startPlanBtn");
    await expect(page.locator("#run")).toBeVisible();
    await expect(page.locator("#curName")).toHaveText("MTG開始まで");
    await expect(page.locator("#curPrev")).toContainText("11/20");
    await expect(page.locator("#curPrev")).toContainText("8日後");
    await expect(page.locator("#curEnd")).toContainText("8日後 10:00:00");
    expect(errors).toEqual([]);
  });

  test("explicit ended date is rejected", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planDate", "2026-11-11");
    await page.fill("#planStart", "10:00:00");
    await page.fill("#totalMin", "30");
    await expect(page.locator("#planDateDisp")).toContainText("前日");
    await expect(page.locator("#startFixedBtn")).toBeDisabled();
    await page.click("#startPlanBtn");
    await expect(page.locator("#run")).toBeHidden();
    await expect(page.locator("#toast")).toContainText("指定した日時は会議終了時刻を過ぎています");
    expect(errors).toEqual([]);
  });

  test("start now clears an explicit date", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planDate", "2026-11-20");
    await page.fill("#totalMin", "30");
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await expect(page.locator("#planDate")).toHaveValue("");
    expect(errors).toEqual([]);
  });

  test("fixed-end start supports a next-day start within two hours", async ({ page }) => {
    const errors = await setupPage(page, { clockTime: new Date("2026-11-12T14:00:00Z") });
    await page.fill("#planStart", "00:10:00");
    await page.fill("#totalMin", "30");
    await expect(page.locator("#startFixedBtn")).toBeEnabled();
    await page.click("#startFixedBtn");
    await expect(page.locator("#run")).toBeVisible();
    await expect(page.locator("#meetEnd")).toHaveText("翌 0:40:00");
    await expect(page.locator("#toast")).toContainText("早く開始します");
    expect(errors).toEqual([]);
  });

  test("start-now-with-fixed-end supports a late start", async ({ page }) => {
    const errors = await setupPage(page, { clockTime: new Date("2026-11-12T01:05:00Z") });
    await page.fill("#totalMin", "30");
    await expect(page.locator("#startFixedBtn")).toBeEnabled();
    await page.click("#startFixedBtn");
    await expect(page.locator("#run")).toBeVisible();
    expect((await statuses(page))[0]).toBe("スキップ");
    await expect(page.locator("#curName")).toContainText("議題1：報告");
    await expect(page.locator("#meetEnd")).toHaveText("10:30:00");
    await expect(page.locator("#toast")).toContainText("遅れて開始します");
    expect(errors).toEqual([]);
  });

  test("fixed-end button is disabled after the planned meeting ended", async ({ page }) => {
    const errors = await setupPage(page, { clockTime: new Date("2026-11-12T11:00:00Z") });
    await page.fill("#planStart", "10:00:00");
    await page.fill("#totalMin", "30");
    await expect(page.locator("#startFixedBtn")).toBeDisabled();
    await expect(page.locator("#nowEndDisp")).toContainText("終了 20:30:00");
    expect(errors).toEqual([]);
  });

  test("fixed-end button is disabled when the plan resolves to tomorrow", async ({ page }) => {
    const errors = await setupPage(page, { clockTime: new Date("2026-11-12T14:00:00Z") });
    await page.fill("#planStart", "10:00:00");
    await page.fill("#totalMin", "30");
    await expect(page.locator("#startFixedBtn")).toBeDisabled();
    await expect(page.locator("#planDateDisp")).toContainText("翌日");
    expect(errors).toEqual([]);
  });

  test("recalculated start preview shows the next day", async ({ page }) => {
    const errors = await setupPage(page, { clockTime: new Date("2026-11-12T14:50:00Z") });
    await page.fill("#totalMin", "30");
    await expect(page.locator("#nowEndDisp")).toContainText("翌 0:20:00");
    expect(errors).toEqual([]);
  });

  test("overrun setting is persisted", async ({ page }) => {
    const errors = await setupPage(page);
    await page.uncheck("#overrunMode");
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mtgTimer.setup.v1")));
    expect(saved.overrunMode).toBe(false);
    expect(errors).toEqual([]);
  });

  test("corrupt saved setup falls back to defaults", async ({ page }) => {
    const errors = await setupPage(page);
    await page.evaluate(() => localStorage.setItem("mtgTimer.setup.v1", "{}"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#totalMin")).toHaveValue("30");
    await expect(page.locator("#planStart")).toHaveValue("10:00:00");
    expect(await page.locator("#agendaBody tr").count()).toBe(4);
    expect(errors).toEqual([]);
  });

  test("finished meetings are recorded in history", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#meetingTitle", "定例会");
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await expect(page.locator("#meetingName")).toHaveText("定例会");
    await expect(page).toHaveTitle(/定例会/);
    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    await page.click("#quitBtn");
    await expect(page.locator("#setup")).toBeVisible();
    await expect(page.locator("#historyCard")).toBeVisible();
    await expect(page.locator("#historyList")).toContainText("定例会");
    await expect(page.locator("#historyList")).toContainText("挨拶・議題確認");

    const detailToggle = page.locator("#historyList button").filter({ hasText: "詳細" }).first();
    await detailToggle.click();
    const historyDetail = page.locator("#historyList .historyDetail").first();
    await expect(historyDetail).toBeVisible();
    await expect(historyDetail).toContainText("挨拶・議題確認");
    await expect(historyDetail).toContainText("完了");
    await expect(detailToggle).toHaveAttribute("aria-expanded", "true");
    await detailToggle.click();
    await expect(historyDetail).toBeHidden();
    await expect(detailToggle).toHaveAttribute("aria-expanded", "false");

    await page.locator("#historyList button").filter({ hasText: "コピー" }).click();
    await page.waitForTimeout(50);
    const copied = await page.evaluate(() => window.__copiedText || "");
    expect(copied).toContain("MTGタイマー結果");
    expect(copied).toContain("会議名: 定例会");
    expect(copied).toContain("挨拶・議題確認");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#historyCard")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.click("#exportHistoryBtn");
    const download = await downloadPromise;
    const path = await download.path();
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    expect(data.history[0].title).toBe("定例会");
    expect(data.history[0].items[0].name).toContain("挨拶");

    const csvDownloadPromise = page.waitForEvent("download");
    await page.click("#exportHistoryCsvBtn");
    const csvDownload = await csvDownloadPromise;
    const csv = fs.readFileSync(await csvDownload.path(), "utf8");
    expect(csv).toContain("会議名,開始,終了");
    expect(csv).toContain("定例会");
    expect(csv).toContain("挨拶・議題確認");

    await page.locator("#historyList button").filter({ hasText: "削除" }).click();
    await expect(page.locator("#historyCard")).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("startNowBtn");

    await page.setInputFiles("#importHistoryFile", path);
    await expect(page.locator("#toast")).toContainText("会議履歴を読み込みました");
    await expect(page.locator("#historyCard")).toBeVisible();
    await expect(page.locator("#historyList")).toContainText("定例会");
    expect(errors).toEqual([]);
  });

  test("history entry can be reused as an agenda template", async ({ page }) => {
    const errors = await setupPage(page);
    await makeSingleAgenda(page, "再利用議題", 0, 2);
    await page.fill("#meetingTitle", "再利用会議");
    await page.fill("#totalMin", "1");
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    await page.click("#quitBtn");
    await expect(page.locator("#historyCard")).toBeVisible();

    await page.locator("#historyList button").filter({ hasText: "再利用" }).click();
    await expect(page.locator("#meetingTitle")).toHaveValue("再利用会議");
    await expect(page.locator("#totalMin")).toHaveValue("1");
    expect(await page.locator("#agendaBody tr").count()).toBe(1);
    await expect(page.locator("#agendaBody tr:nth-child(1) td:nth-child(1) input")).toHaveValue("再利用議題");
    await expect(page.locator("#agendaBody tr:nth-child(1) td:nth-child(2) input")).toHaveValue("0");
    await expect(page.locator("#agendaBody tr:nth-child(1) td:nth-child(3) input")).toHaveValue("2");
    expect(errors).toEqual([]);
  });

  test("template selection applies a preset", async ({ page }) => {
    const errors = await setupPage(page);
    await page.selectOption("#templateSelect", "short");
    await page.click("#applyTemplateBtn");
    await expect(page.locator("#totalMin")).toHaveValue("15");
    expect(await page.locator("#agendaBody tr").count()).toBe(4);
    await expect(page.locator("#agendaBody tr:nth-child(1) td:nth-child(1) input")).toHaveValue("挨拶");
    await expect(page.locator("#sumDisp")).toHaveText("15:00");
    expect(errors).toEqual([]);
  });

  test("JSON export downloads the current setup", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planDate", "2026-11-20");
    await page.fill("#meetingTitle", "定例会");
    const downloadPromise = page.waitForEvent("download");
    await page.click("#exportBtn");
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("mtg-timer-settings.json");
    const path = await download.path();
    const data = JSON.parse(fs.readFileSync(path, "utf8"));
    expect(data.app).toBe("mtg-timer");
    expect(data.version).toBe(1);
    expect(data.totalMin).toBe(30);
    expect(data.planDate).toBe("2026-11-20");
    expect(data.meetingTitle).toBe("定例会");
    expect(data.rows).toHaveLength(4);
    expect(errors).toEqual([]);
  });

  test("JSON import applies a setup", async ({ page }) => {
    const errors = await setupPage(page);
    const imported = {
      planStart: "09:30:00",
      planDate: "2026-11-20",
      meetingTitle: "取込会議",
      totalMin: 20,
      preStartMin: 3,
      preEndSec: 20,
      overrunMode: false,
      rows: [
        { name: "読込A", min: 2, sec: 0 },
        { name: "読込B", min: 8, sec: 0 }
      ]
    };
    await page.setInputFiles("#importFile", {
      name: "settings.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported))
    });
    await expect(page.locator("#toast")).toContainText("設定を読み込みました");
    await expect(page.locator("#planStart")).toHaveValue("09:30:00");
    await expect(page.locator("#totalMin")).toHaveValue("20");
    await expect(page.locator("#planDate")).toHaveValue("2026-11-20");
    await expect(page.locator("#meetingTitle")).toHaveValue("取込会議");
    await expect(page.locator("#preStartMin")).toHaveValue("3");
    await expect(page.locator("#preEndSec")).toHaveValue("20");
    await expect(page.locator("#overrunMode")).not.toBeChecked();
    expect(await page.locator("#agendaBody tr").count()).toBe(2);
    await expect(page.locator("#agendaBody tr:nth-child(1) td:nth-child(1) input")).toHaveValue("読込A");
    await expect(page.locator("#sumDisp")).toHaveText("10:00");
    expect(errors).toEqual([]);
  });

  test("partial JSON import keeps unspecified settings", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#preStartMin", "4");
    await page.fill("#preEndSec", "25");
    await page.uncheck("#overrunMode");
    await page.setInputFiles("#importFile", {
      name: "rows-only.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ rows: [{ name: "部分読込", min: 5, sec: 0 }] }))
    });
    await expect(page.locator("#toast")).toContainText("設定を読み込みました");
    await expect(page.locator("#totalMin")).toHaveValue("30");
    await expect(page.locator("#preStartMin")).toHaveValue("4");
    await expect(page.locator("#preEndSec")).toHaveValue("25");
    await expect(page.locator("#overrunMode")).not.toBeChecked();
    expect(await page.locator("#agendaBody tr").count()).toBe(1);
    await expect(page.locator("#agendaBody tr:nth-child(1) td:nth-child(1) input")).toHaveValue("部分読込");
    expect(errors).toEqual([]);
  });

  test("JSON import can clear an explicit date", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#planDate", "2026-11-20");
    await page.setInputFiles("#importFile", {
      name: "clear-date.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ planDate: "" }))
    });
    await expect(page.locator("#toast")).toContainText("設定を読み込みました");
    await expect(page.locator("#planDate")).toHaveValue("");
    expect(errors).toEqual([]);
  });

  test("JSON import can update only the overrun setting", async ({ page }) => {
    const errors = await setupPage(page);
    await page.uncheck("#overrunMode");
    await page.setInputFiles("#importFile", {
      name: "overrun.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ overrunMode: true }))
    });
    await expect(page.locator("#toast")).toContainText("設定を読み込みました");
    await expect(page.locator("#overrunMode")).toBeChecked();
    expect(errors).toEqual([]);
  });

  test("history CSV protects against formula injection", async ({ page }) => {
    const errors = await setupPage(page);
    await page.fill("#meetingTitle", '=1+1,"x"');
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    await page.click("#quitBtn");
    await expect(page.locator("#historyCard")).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.click("#exportHistoryCsvBtn");
    const download = await downloadPromise;
    const csv = fs.readFileSync(await download.path(), "utf8");
    expect(csv).toContain("\"'=1+1,\"\"x\"\"\"");
    expect(csv.split("\n")[1].startsWith("\"'=1+1")).toBe(true);
    expect(errors).toEqual([]);
  });

  test("history import rejects empty agendas and caps notes", async ({ page }) => {
    const errors = await setupPage(page);
    const now = Date.now();
    const base = {
      planStartMs: now - 600000,
      actStartMs: now - 600000,
      meetEndMs: now - 300000,
      actualEndMs: now - 300000
    };
    await page.setInputFiles("#importHistoryFile", {
      name: "history-validation.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        history: [
          { id: "empty", title: "空", ...base, items: [] },
          { id: "long", title: "長文", ...base, items: [{ name: "議題", status: "done", endMs: now - 300000, note: "x".repeat(1000) }] }
        ]
      }))
    });
    await expect(page.locator("#toast")).toContainText("1件の会議履歴を読み込みました");
    await expect(page.locator("#historyCard")).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("mtgTimer.history.v1")));
    expect(stored.map((entry) => entry.title)).toEqual(["長文"]);
    expect(stored[0].items[0].note.length).toBe(500);
    expect(errors).toEqual([]);
  });

  test("history summary reports count, average, overrun, and skips", async ({ page }) => {
    const errors = await setupPage(page);
    const now = Date.now();
    const mk = (id, title, actualMin) => ({
      id,
      title,
      planStartMs: now - 1200000,
      actStartMs: now - 1200000,
      meetEndMs: now - 600000,
      actualEndMs: now - 1200000 + actualMin * 60000,
      items: [
        { name: title + "1", status: "skip", endMs: now - 900000, note: "" },
        { name: title + "2", status: "done", endMs: now - 1200000 + actualMin * 60000, note: "" }
      ]
    });
    await page.setInputFiles("#importHistoryFile", {
      name: "history-summary.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ history: [mk("a", "A会議", 10), mk("b", "B会議", 12)] }))
    });
    await expect(page.locator("#toast")).toContainText("2件の会議履歴を読み込みました");
    await expect(page.locator("#historySummary")).toContainText("履歴2件");
    await expect(page.locator("#historySummary")).toContainText("平均実績 11分");
    await expect(page.locator("#historySummary")).toContainText("平均超過 +1分");
    await expect(page.locator("#historySummary")).toContainText("スキップ 2件");
    expect(errors).toEqual([]);
  });

  test("start works when Web Locks throws", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: { request() { throw new Error("locks unavailable"); } }
      });
    });
    const errors = await setupPage(page);
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("history delete focus moves to the next entry", async ({ page }) => {
    const errors = await setupPage(page);
    const now = Date.now();
    const mk = (id, title) => ({
      id,
      title,
      planStartMs: now - 600000,
      actStartMs: now - 600000,
      meetEndMs: now - 300000,
      actualEndMs: now - 300000,
      items: [{ name: "A", status: "done", endMs: now - 300000, note: "" }]
    });
    await page.setInputFiles("#importHistoryFile", {
      name: "two-history.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ history: [mk("a", "A会議"), mk("b", "B会議")] }))
    });
    await expect(page.locator("#historyList .historyItem")).toHaveCount(2);

    await page.locator("#historyList .historyOps button:last-child").first().click();
    await expect(page.locator("#historyList .historyItem")).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.textContent)).toBe("削除");
    expect(await page.evaluate(() => document.activeElement && document.activeElement.closest(".historyItem") && document.activeElement.closest(".historyItem").textContent)).toContain("B会議");
    expect(errors).toEqual([]);
  });

  test("empty history import reports no new entries", async ({ page }) => {
    const errors = await setupPage(page);
    await page.setInputFiles("#importHistoryFile", {
      name: "empty-history.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ history: [] }))
    });
    await expect(page.locator("#toast")).toContainText("新しい会議履歴はありませんでした");
    expect(errors).toEqual([]);
  });

  test("oversized JSON import is rejected", async ({ page }) => {
    const errors = await setupPage(page);
    await page.setInputFiles("#importFile", {
      name: "big.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(1024 * 1024 + 1, 32)
    });
    await expect(page.locator("#toast")).toContainText("JSONファイルが大きすぎます");
    expect(errors).toEqual([]);
  });

  test("keyboard shortcuts operate the timer", async ({ page }) => {
    const errors = await setupPage(page);
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("curName");

    await page.keyboard.press("n");
    await expect(page.locator("#runBody tr:nth-child(1) td:nth-child(4)")).toHaveText("スキップ");
    await expect(page.locator("#curName")).toContainText("議題1：報告");

    await page.keyboard.press("b");
    await expect(page.locator("#curName")).toContainText("挨拶・議題確認");

    await page.keyboard.press("e");
    await expect(page.locator("#meetEnd")).toHaveText("10:35:00");

    await page.keyboard.press("?");
    await expect(page.locator("#bTitle")).toContainText("キーボードショートカット");

    await page.keyboard.press("f");
    await expect(page.locator("#curName")).toHaveText("終了");

    await page.keyboard.press("q");
    await expect(page.locator("#setup")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("startNowBtn");
    expect(errors).toEqual([]);
  });

  test("focus moves for agenda controls and screen transitions", async ({ page }) => {
    const errors = await setupPage(page);
    await page.locator("#agendaBody tr:nth-child(1) td:nth-child(5) button[title=\"下へ移動\"]").click();
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.title)).toBe("下へ移動");

    await page.click("#addItem");
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.className)).toBe("nm");

    await page.fill("#totalMin", "60");
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("curName");

    await page.click("#finishBtn");
    await expect(page.locator("#curName")).toHaveText("終了");
    await page.click("#quitBtn");
    await expect(page.locator("#setup")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("startNowBtn");
    expect(errors).toEqual([]);
  });

  test("only one tab can run a timer at a time", async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    const errors1 = await setupPage(page1);
    const errors2 = await setupPage(page2);

    await page1.click("#startNowBtn");
    await expect(page1.locator("#run")).toBeVisible();

    await page2.click("#startNowBtn");
    await expect(page2.locator("#run")).toBeHidden();
    await expect(page2.locator("#toast")).toContainText("別タブでタイマーが実行中です");

    await page1.click("#finishBtn");
    await expect(page1.locator("#curName")).toHaveText("終了");

    await page2.click("#startNowBtn");
    await expect(page2.locator("#run")).toBeVisible();

    expect(errors1).toEqual([]);
    expect(errors2).toEqual([]);
  });

  test("notification, ARIA, and fullscreen work", async ({ page }) => {
    const errors = await setupPage(page);
    await expect(page.locator("#banner")).toHaveAttribute("role", "alert");
    await expect(page.locator("#toast")).toHaveAttribute("role", "status");
    await page.click("#notifyBtn");
    await page.waitForTimeout(50);
    await expect(page.locator("#notifyBtn")).toHaveText("通知有効");
    await page.evaluate(() => { window.__forceHidden = true; });
    await page.click("#startNowBtn");
    await page.clock.fastForward(31000);
    await page.waitForTimeout(100);
    const notifications = await page.evaluate(() => window.__notifications);
    expect(notifications.some((n) => /まもなく終了/.test(n.title))).toBe(true);
    await expect(page.locator("#soundBtn")).toHaveAttribute("aria-pressed", "true");
    await page.click("#fsBtn");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("notification actions extend and finish the run", async ({ page }) => {
    const errors = await setupPage(page);
    await page.click("#notifyBtn");
    await page.waitForTimeout(50);
    await page.fill("#totalMin", "1");
    await makeSingleAgenda(page, "通知議題", 0, 10);
    await page.evaluate(() => { window.__forceHidden = true; });
    await page.click("#startNowBtn");
    await expect(page.locator("#run")).toBeVisible();
    await page.clock.fastForward(61000);
    await expect(page.locator("#curName")).toHaveText("超過中");

    const notifications = await page.evaluate(() => window.__notifications);
    const overrun = notifications.find((n) => n.title === "終了時刻を超過");
    expect(overrun).toBeTruthy();
    expect(overrun.options.actions.map((a) => a.action)).toEqual(["extend5", "finish"]);

    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
        data: { type: "notification-action", action: "extend5" }
      }));
    });
    await expect(page.locator("#curName")).not.toHaveText("超過中");
    await expect(page.locator("#meetEnd")).toHaveText(/10:06:0[01]/);

    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
        data: { type: "notification-action", action: "finish" }
      }));
    });
    await expect(page.locator("#curName")).toHaveText("終了");
    expect(errors).toEqual([]);
  });

  test("service worker enables offline reload", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await page.goto("/");
    const active = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      return !!registration.active;
    });
    expect(active).toBe(true);
    await page.context().setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#startNowBtn")).toBeVisible();
    await page.context().setOffline(false);
  });

  test("PWA assets are available", async ({ page }) => {
    await setupPage(page);
    const manifestResponse = await page.request.get("/manifest.json");
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe("MTGタイマー");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    expect((await page.request.get("/icons/icon-192.png")).ok()).toBe(true);
    expect((await page.request.get("/icons/icon-512.png")).ok()).toBe(true);
    expect((await page.request.get("/sw.js")).ok()).toBe(true);
    expect((await page.request.get("/js/history.js")).ok()).toBe(true);
    expect((await page.request.get("/js/ui.js")).ok()).toBe(true);
    expect((await page.request.get("/js/result.js")).ok()).toBe(true);
    expect((await page.request.get("/js/setup.js")).ok()).toBe(true);
    expect((await page.request.get("/js/run-view.js")).ok()).toBe(true);
    expect((await page.request.get("/js/run-state.js")).ok()).toBe(true);
    expect((await page.request.get("/js/run.js")).ok()).toBe(true);
    expect((await page.request.get("/js/run-alarms.js")).ok()).toBe(true);
  });
});
