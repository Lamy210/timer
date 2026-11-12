const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function pad(n) { return String(n).padStart(2, "0"); }
export function jstParts(ms) {
  const d = new Date(ms + JST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    ms: d.getUTCMilliseconds()
  };
}

export function fmtHMS(ms) {
  const p = jstParts(ms);
  return pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s);
}

export function fmtClock(ms) {
  const p = jstParts(ms);
  return p.h + ":" + pad(p.mi) + ":" + pad(p.s);
}

export function dayIndexJst(ms) {
  const p = jstParts(ms);
  return Math.floor(Date.UTC(p.y, p.mo, p.d) / DAY_MS);
}

export function fmtClockRel(ms, refMs) {
  const diff = dayIndexJst(ms) - dayIndexJst(refMs);
  const prefix = diff === 1 ? "翌 " : diff > 1 ? diff + "日後 " : diff === -1 ? "前日 " : diff < -1 ? Math.abs(diff) + "日前 " : "";
  return prefix + fmtClock(ms);
}

export function fmtDateJst(ms) {
  const p = jstParts(ms);
  const wd = new Date(Date.UTC(p.y, p.mo, p.d)).getUTCDay();
  return (p.mo + 1) + "/" + p.d + "（" + WEEKDAYS[wd] + "）";
}

export function fmtPlanStartLabel(ms, refMs) {
  const diff = dayIndexJst(ms) - dayIndexJst(refMs);
  const rel = diff === 0 ? "本日" : diff === 1 ? "翌日" : diff > 1 ? diff + "日後" : diff === -1 ? "前日" : diff < -1 ? Math.abs(diff) + "日前" : "";
  return rel + " " + fmtDateJst(ms) + " " + fmtClock(ms);
}

export function resolvePlanStartMs(todSec, totalSec, nowMs) {
  let ms = todToMs(todSec, nowMs);
  if (nowMs >= ms + totalSec * 1000) ms += DAY_MS;
  return ms;
}

export function parseDateString(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const utc = Date.UTC(y, mo, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo || check.getUTCDate() !== d) return null;
  return { y: y, mo: mo, d: d };
}

export function dateTodToMs(dateStr, todSec) {
  const p = parseDateString(dateStr);
  if (!p) return null;
  return Date.UTC(p.y, p.mo, p.d) - JST_OFFSET_MS + todSec * 1000;
}

export function isValidDateString(dateStr) {
  return parseDateString(dateStr) != null;
}

export function getFixedStartInfoFromMs(planStartMs, totalSec, nowMs) {
  if (!Number.isFinite(planStartMs) || totalSec <= 0) return null;
  const meetEndMs = planStartMs + totalSec * 1000;
  if (nowMs >= meetEndMs) return null;
  if (planStartMs > nowMs && planStartMs - nowMs > 2 * 60 * 60 * 1000) return null;
  return { planStartMs: planStartMs, meetEndMs: meetEndMs };
}

export function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
}

export function remainSpeech(ms) {
  if (ms >= 60000) return "約" + Math.ceil(ms / 60000) + "分";
  return Math.max(1, Math.ceil(ms / 1000)) + "秒";
}

export function parseTime(str) {
  if (!str) return null;
  const p = String(str).split(":").map(Number);
  if (p.length < 2 || p.some(isNaN)) return null;
  const h = p[0], m = p[1], s = p.length > 2 ? p[2] : 0;
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

export function todToMs(todSec, refMs) {
  const p = jstParts(refMs);
  let candidate = Date.UTC(p.y, p.mo, p.d) - JST_OFFSET_MS + todSec * 1000;
  const half = 12 * 60 * 60 * 1000;
  if (candidate - refMs > half) candidate -= DAY_MS;
  else if (candidate - refMs < -half) candidate += DAY_MS;
  return candidate;
}

export function clampNum(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}
