function pad(value) {
  return String(value).padStart(2, "0");
}

export function toIcsUtc(ms) {
  const date = new Date(ms);
  return date.getUTCFullYear()
    + pad(date.getUTCMonth() + 1)
    + pad(date.getUTCDate())
    + "T"
    + pad(date.getUTCHours())
    + pad(date.getUTCMinutes())
    + pad(date.getUTCSeconds())
    + "Z";
}

export function escapeIcsText(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatAgenda(agenda) {
  if (!Array.isArray(agenda) || agenda.length === 0) return "";
  return agenda.map((row, index) => {
    const name = String(row && row.name || "（無題の議題）");
    const min = Number(row && row.min) || 0;
    const sec = Number(row && row.sec) || 0;
    const duration = sec ? min + "分" + sec + "秒" : min + "分";
    return (index + 1) + ". " + name + " (" + duration + ")";
  }).join("\n");
}

export function buildIcsEvent({ title, memo, agenda, startMs, endMs, now = Date.now() }) {
  const summary = String(title || "").trim() || "MTG";
  const description = [String(memo || "").trim(), formatAgenda(agenda)].filter(Boolean).join("\n\n");
  const uid = "mtg-timer-" + startMs + "-" + endMs + "@github-pages";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MTG Timer//JP",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + toIcsUtc(now),
    "DTSTART:" + toIcsUtc(startMs),
    "DTEND:" + toIcsUtc(endMs),
    "SUMMARY:" + escapeIcsText(summary),
    "DESCRIPTION:" + escapeIcsText(description),
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ];
  return lines.join("\r\n");
}
