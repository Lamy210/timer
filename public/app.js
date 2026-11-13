import { requestNotificationPermission } from "./js/alerts.js";
import { $, toast } from "./js/ui.js";
import { initHistory, renderHistory } from "./js/history.js";
import { initSetup, setupClockTick, applyHistoryTemplate } from "./js/setup.js";
import { initRun, startRun, restoreRun } from "./js/run.js";

function updateNotifyButton() {
  const btn = $("notifyBtn");
  if (!btn) return;
  if (!("Notification" in window)) {
    btn.disabled = true;
    btn.textContent = "通知非対応";
    return;
  }
  if (Notification.permission === "granted") {
    btn.disabled = true;
    btn.textContent = "通知有効";
  } else if (Notification.permission === "denied") {
    btn.disabled = true;
    btn.textContent = "通知ブロック中";
  } else {
    btn.disabled = false;
    btn.textContent = "通知を有効化";
  }
}

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $("installBtn").hidden = false;
});

$("installBtn").addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  $("installBtn").hidden = true;
  try {
    prompt.prompt();
    await prompt.userChoice;
  } catch (e) {}
});

window.addEventListener("appinstalled", () => {
  $("installBtn").hidden = true;
});


$("notifyBtn").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    toast("このブラウザは通知に対応していません。");
    return;
  }
  try {
    const permission = await requestNotificationPermission();
    updateNotifyButton();
    toast(permission === "granted"
      ? "通知を有効にしました。タブが非表示のときも通知します。"
      : "通知が許可されませんでした。ブラウザの設定を確認してください。");
  } catch (e) {
    toast("通知を有効にできませんでした。");
  }
});

if (!document.documentElement.requestFullscreen) $("fsBtn").hidden = true;
$("fsBtn").addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (e) {
    toast("全画面表示にできませんでした。");
  }
});

document.addEventListener("fullscreenchange", () => {
  $("fsBtn").textContent = document.fullscreenElement ? "全画面を終了" : "全画面";
});

try {
  if ("speechSynthesis" in window) {
    speechSynthesis.getVoices();
    if (speechSynthesis.addEventListener) {
      speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
    }
  }
} catch (e) {}

if ("serviceWorker" in navigator && !navigator.webdriver && !location.search.includes("no-sw")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).then((registration) => {
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            toast("新しいバージョンがあります。再読み込みしてください。", 8000);
          }
        });
      });
    }).catch(() => {});
  });
}

initSetup({ onStart: startRun });
initHistory({ onApplyTemplate: applyHistoryTemplate });
renderHistory();
updateNotifyButton();
setupClockTick();
setInterval(setupClockTick, 1000);
initRun();
restoreRun();
