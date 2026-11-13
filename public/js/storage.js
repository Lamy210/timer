import { clampNum, parseTime, isValidDateString } from "./time.js";

export const STORAGE_SETUP = "mtgTimer.setup.v1";
export const STORAGE_RUN = "mtgTimer.run.v1";
export const STORAGE_HISTORY = "mtgTimer.history.v1";
const HISTORY_MAX = 20;

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
  if (typeof saved.meetingTitle === "string") {
    data.meetingTitle = saved.meetingTitle.slice(0, 100);
  }
  const rows = normalizeRows(saved.rows);
  if (rows && rows.length) data.rows = rows;
  return Object.keys(data).length ? data : null;
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

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.id !== "string" || !entry.id) return null;
  if (!Number.isFinite(entry.planStartMs) || !Number.isFinite(entry.actStartMs)
    || !Number.isFinite(entry.meetEndMs) || !Number.isFinite(entry.actualEndMs)
    || !Array.isArray(entry.items) || entry.items.length === 0) return null;
  const items = entry.items.slice(0, 100).map((it) => ({
    name: String(it && it.name || "").slice(0, 200),
    status: ["done", "skip", "run", "wait"].includes(it && it.status) ? it.status : "done",
    endMs: Number.isFinite(it && it.endMs) ? it.endMs : entry.actualEndMs,
    note: String(it && it.note || "").slice(0, 500)
  }));
  return {
    id: entry.id,
    title: typeof entry.title === "string" ? entry.title.slice(0, 100) : "",
    planStartMs: entry.planStartMs,
    actStartMs: entry.actStartMs,
    meetEndMs: entry.meetEndMs,
    actualEndMs: entry.actualEndMs,
    items: items
  };
}

export function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeHistoryEntry).filter(Boolean).slice(0, HISTORY_MAX);
  } catch (e) {
    return [];
  }
}

export function saveHistoryEntry(entry) {
  const normalized = normalizeHistoryEntry(entry);
  if (!normalized) return loadHistory();
  const history = loadHistory().filter((item) => item.id !== normalized.id);
  history.unshift(normalized);
  const next = history.slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(next));
  } catch (e) {}
  return next;
}

export function mergeHistoryEntries(entries) {
  const existing = loadHistory();
  if (!Array.isArray(entries)) return { history: existing, added: 0 };
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  entries.forEach((entry) => {
    const normalized = normalizeHistoryEntry(entry);
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
  });
  const next = Array.from(byId.values())
    .sort((a, b) => b.actualEndMs - a.actualEndMs)
    .slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(next));
  } catch (e) {}
  const existingIds = new Set(existing.map((entry) => entry.id));
  return { history: next, added: next.filter((entry) => !existingIds.has(entry.id)).length };
}

export function deleteHistoryEntry(id) {
  const next = loadHistory().filter((entry) => entry.id !== id);
  try {
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(next));
  } catch (e) {}
  return next;
}

export function clearHistoryData() {
  try {
    localStorage.removeItem(STORAGE_HISTORY);
  } catch (e) {}
  return [];
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
