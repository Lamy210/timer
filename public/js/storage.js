import { clampNum, parseTime, isValidDateString } from "./time.js";

export const STORAGE_SETUP = "mtgTimer.setup.v1";
export const STORAGE_RUN = "mtgTimer.run.v1";

export const TEMPLATES = {
  standard: {
    label: "標準（30分）",
    totalMin: 30,
    rows: [
      { name: "挨拶・議題確認", min: 1, sec: 0 },
      { name: "議題1：報告", min: 9, sec: 0 },
      { name: "議題2：討議", min: 15, sec: 0 },
      { name: "まとめ・次回予定", min: 5, sec: 0 }
    ]
  },
  short: {
    label: "短縮（15分）",
    totalMin: 15,
    rows: [
      { name: "挨拶", min: 1, sec: 0 },
      { name: "報告", min: 4, sec: 0 },
      { name: "討議", min: 7, sec: 0 },
      { name: "まとめ", min: 3, sec: 0 }
    ]
  },
  long: {
    label: "長期（60分）",
    totalMin: 60,
    rows: [
      { name: "挨拶・目的確認", min: 2, sec: 0 },
      { name: "報告", min: 10, sec: 0 },
      { name: "討議", min: 30, sec: 0 },
      { name: "その他", min: 13, sec: 0 },
      { name: "まとめ・次回予定", min: 5, sec: 0 }
    ]
  }
};

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return null;
  return rows.slice(0, 100).map((row) => ({
    name: String(row && row.name || "").slice(0, 200),
    min: clampNum(row && row.min, 0, 600),
    sec: clampNum(row && row.sec, 0, 59)
  }));
}

export function normalizeSetupData(saved) {
  if (!saved || typeof saved !== "object") return null;
  const hasRows = Array.isArray(saved.rows) && saved.rows.length > 0;
  if (saved.planStart == null && saved.planDate == null && saved.totalMin == null && saved.preStartMin == null && saved.preEndSec == null && !hasRows) {
    return null;
  }
  const data = {};
  if (saved.totalMin != null) data.totalMin = clampNum(saved.totalMin, 1, 480);
  if (saved.preStartMin != null) data.preStartMin = clampNum(saved.preStartMin, 0, 60);
  if (saved.preEndSec != null) data.preEndSec = clampNum(saved.preEndSec, 0, 300);
  if (typeof saved.overrunMode === "boolean") data.overrunMode = saved.overrunMode;
  if (typeof saved.planStart === "string" && parseTime(saved.planStart) != null) {
    data.planStart = saved.planStart;
  }
  if (typeof saved.planDate === "string" && (saved.planDate === "" || isValidDateString(saved.planDate))) {
    data.planDate = saved.planDate;
  }
  const rows = normalizeRows(saved.rows);
  if (rows && rows.length) data.rows = rows;
  return data;
}

export function loadSetupData() {
  try {
    const raw = localStorage.getItem(STORAGE_SETUP);
    if (!raw) return null;
    return normalizeSetupData(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

export function saveSetupData(data) {
  try {
    localStorage.setItem(STORAGE_SETUP, JSON.stringify(data));
  } catch (e) {}
}

export function loadRunData() {
  try {
    const raw = sessionStorage.getItem(STORAGE_RUN);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function saveRunData(run) {
  try {
    if (run && !run.ended) sessionStorage.setItem(STORAGE_RUN, JSON.stringify(run));
    else sessionStorage.removeItem(STORAGE_RUN);
  } catch (e) {}
}

export function clearRunData() {
  try {
    sessionStorage.removeItem(STORAGE_RUN);
  } catch (e) {}
}

export function serializeSetup(data) {
  return JSON.stringify({
    app: "mtg-timer",
    version: 1,
    ...data
  }, null, 2);
}

export function parseImportedSetup(text) {
  try {
    return normalizeSetupData(JSON.parse(text));
  } catch (e) {
    return null;
  }
}
