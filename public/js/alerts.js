const SEQUENCES = {
  preStart: [
    [784, 0, 0.1, 0.24],
    [1046, 0.15, 0.14, 0.28],
    [1318, 0.32, 0.18, 0.3]
  ],
  pre: [
    [1046, 0, 0.09, 0.24],
    [1046, 0.14, 0.09, 0.24],
    [1046, 0.28, 0.12, 0.26]
  ],
  item: [
    [880, 0, 0.1, 0.3],
    [880, 0.18, 0.1, 0.3]
  ],
  end: [
    [880, 0, 0.24, 0.32],
    [660, 0.3, 0.24, 0.32],
    [880, 0.6, 0.24, 0.32],
    [660, 0.9, 0.24, 0.32],
    [880, 1.2, 0.24, 0.32],
    [1320, 1.7, 0.5, 0.28]
  ]
};

let AC = null;
let masterGain = null;
let soundOn = true;
let audioUnlocked = false;
let scheduledNodes = [];

function ensureMaster() {
  if (!AC) return null;
  if (!masterGain) {
    masterGain = AC.createGain();
    masterGain.gain.value = soundOn ? 1 : 0;
    masterGain.connect(AC.destination);
  }
  return masterGain;
}

function beepAt(freq, when, dur, vol) {
  if (!AC) return null;
  const dest = ensureMaster() || AC.destination;
  const o = AC.createOscillator();
  const g = AC.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.01);
  g.gain.setValueAtTime(vol, when + dur - 0.02);
  g.gain.linearRampToValueAtTime(0, when + dur);
  o.connect(g);
  g.connect(dest);
  o.start(when);
  o.stop(when + dur + 0.05);
  return o;
}

export function getSoundOn() {
  return soundOn;
}

export function setSoundOn(value) {
  soundOn = !!value;
  if (masterGain) masterGain.gain.value = soundOn ? 1 : 0;
  return soundOn;
}

export function isAudioUnlocked() {
  return audioUnlocked;
}

export function audioNow() {
  return AC ? AC.currentTime : 0;
}

export function vibrateSequence(name) {
  if (!soundOn || !("vibrate" in navigator)) return;
  const patterns = {
    preStart: [120, 80, 120],
    pre: [100, 60, 100],
    item: [120, 80, 120],
    end: [300, 120, 300, 120, 500]
  };
  try {
    navigator.vibrate(patterns[name] || 120);
  } catch (e) {}
}

export function playSequence(name) {
  if (!soundOn || !AC) return;
  const seq = SEQUENCES[name];
  if (!seq) return;
  const base = AC.currentTime;
  seq.forEach((item) => beepAt(item[0], base + item[1], item[2], item[3]));
}

export function scheduleSequence(name, whenSec) {
  if (!AC || !audioUnlocked) return false;
  const seq = SEQUENCES[name];
  if (!seq) return false;
  seq.forEach((item) => {
    const node = beepAt(item[0], whenSec + item[1], item[2], item[3]);
    if (node) scheduledNodes.push(node);
  });
  return true;
}

export function clearScheduled() {
  scheduledNodes.forEach((node) => {
    try { node.stop(); } catch (e) {}
    try { node.disconnect(); } catch (e) {}
  });
  scheduledNodes = [];
}

export function unlockAudio(onUnlocked) {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC) {
      ensureMaster();
      const resume = AC.state === "suspended" ? AC.resume() : Promise.resolve();
      Promise.resolve(resume).then(() => {
        audioUnlocked = true;
        if (typeof onUnlocked === "function") onUnlocked();
      }).catch(() => {});
    }
  } catch (e) {
    AC = null;
  }
}

export function speak(text) {
  if (!soundOn) return;
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    const vs = speechSynthesis.getVoices();
    for (let i = 0; i < vs.length; i++) {
      if (/ja|JP/i.test(vs[i].lang) || /日本|Japanese/i.test(vs[i].name)) {
        u.voice = vs[i];
        break;
      }
    }
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}

export function cancelSpeech() {
  try {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  } catch (e) {}
}

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch (e) {
    return "denied";
  }
}

function supportsNotificationActions() {
  return typeof Notification !== "undefined"
    && Number.isFinite(Notification.maxActions)
    && Notification.maxActions > 0;
}

export async function notify(title, body, extra = {}) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (document.visibilityState === "visible") return;
    const options = {
      body: body,
      tag: extra.tag || "mtg-timer",
      icon: "./icons/icon-192.png"
    };
    if (supportsNotificationActions()) {
      options.renotify = true;
      if (Array.isArray(extra.actions) && extra.actions.length > 0) options.actions = extra.actions;
      if (extra.requireInteraction) options.requireInteraction = true;
    }
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.active) {
        try {
          await reg.showNotification(title, options);
          return;
        } catch (e) {}
      }
    }
    new Notification(title, options);
  } catch (e) {}
}
