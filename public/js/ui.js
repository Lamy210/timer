export const $ = (id) => document.getElementById(id);

let toastTimer = null;

export function toast(msg, duration) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), duration || 4000);
}

export function fallbackCopy(text) {
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
    }
  });
}

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}
