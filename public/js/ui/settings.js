// ============================================================
// settings.js — the Control Panel (sound and comfort).
// ============================================================
// The gear button opens this. It holds the things that are about
// YOUR tablet, not about the game: how loud the music is, whether
// there is a trail, how much the screen shakes. They last while this
// page is open and are saved nowhere.
//
// How the game PLAYS — gravity, jump power, how fast the rocket
// pushes — is not in here at all any more. Those numbers belong to
// each LEVEL now (the ⚙ Rules button in the level editor), so a moon
// level and a heavy level can both exist. The numbers they start from
// live in js/config.js.

import { CONFIG, DEFAULTS } from "../config.js";
import { Music } from "../music.js";

// The bit of the game the panel needs to know about (are we playing?
// which song?). main.js hands it over in initSettings().
let S = null;

// Each slider: [CONFIG name, label the kids see, smallest, biggest, step]
const PANEL_SLIDERS = [
  ["SCREEN_SHAKE", "Screen shake", 0, 30, 1],
  ["MUSIC_VOLUME", "Music volume", 0, 1, 0.05],
  ["MUSIC_BPM",    "Music speed (0 = each song's own)", 0, 200, 1],
];
// Each switch: [CONFIG name, label]
const PANEL_TOGGLES = [
  ["TRAIL", "Glowing trail"],
  ["SOUND", "Sound"],
  ["MUSIC", "Music"],
  ["BEAT_PULSE", "Beat pulse"],
];
// Everything the panel touches, so Reset can put back exactly those and
// nothing else. (A whole-CONFIG reset would wipe the rules of the level
// you're playing right now — see js/rules.js.)
const PANEL_KEYS = [...PANEL_SLIDERS.map(s => s[0]), ...PANEL_TOGGLES.map(t => t[0])];

const panelControlsEl = document.getElementById("panelControls");
function buildPanel() {
  panelControlsEl.innerHTML = "";
  for (const [key, label, min, max, step] of PANEL_SLIDERS) {
    const wrap = document.createElement("div");
    wrap.className = "ctrl";
    wrap.innerHTML =
      '<div class="row"><span>' + label + '</span><span class="val"></span></div>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '">';
    const slider = wrap.querySelector("input");
    const valEl = wrap.querySelector(".val");
    slider.value = CONFIG[key];
    valEl.textContent = CONFIG[key];
    slider.addEventListener("input", () => {
      CONFIG[key] = Number(slider.value);
      valEl.textContent = slider.value;
      // A couple of settings change the music live while the song plays.
      if (key === "MUSIC_VOLUME") Music.setVolume(CONFIG.MUSIC_VOLUME);
      if (key === "MUSIC_BPM") Music.setBpm(CONFIG.MUSIC_BPM);
    });
    panelControlsEl.appendChild(wrap);
  }
  for (const [key, label] of PANEL_TOGGLES) {
    const wrap = document.createElement("div");
    wrap.className = "ctrl toggle";
    wrap.innerHTML =
      '<label class="row"><span>' + label + '</span>' +
      '<input type="checkbox"' + (CONFIG[key] ? " checked" : "") + '></label>';
    const box = wrap.querySelector("input");
    box.addEventListener("change", () => {
      CONFIG[key] = box.checked;
      // Turning Music on/off starts or stops the song right away.
      if (key === "MUSIC") { if (box.checked) Music.start(S.songIndex, CONFIG.MUSIC_VOLUME); else Music.stop(); }
    });
    panelControlsEl.appendChild(wrap);
  }
}

export function isPanelOpen() { return !document.getElementById("controlPanel").classList.contains("hidden"); }
// The panel opens from the menu (gear on the title screen) OR mid-game (gear
// in the corner). In a game we pause; the Close button's words fit where we are.
export function openPanel() {
  if (S.screen === "game") S.paused = true;
  buildPanel();                 // fill in the sliders with the current numbers
  document.getElementById("closePanelBtn").textContent = (S.screen === "game") ? "Close & play" : "Close";
  document.getElementById("controlPanel").classList.remove("hidden");
}
export function closePanel() {
  document.getElementById("controlPanel").classList.add("hidden");
  if (S.screen === "game") S.paused = false;
}

// Wire up the panel's buttons. main.js calls this once at startup.
export function initSettings(deps) {
  S = deps.S;

  document.getElementById("closePanelBtn").onclick = closePanel;

  // Reset: put the panel's own settings back the way the game ships.
  // ONLY the panel's own — the level you're playing may have borrowed
  // some of the game's other numbers, and those are not ours to touch.
  document.getElementById("resetCfgBtn").onclick = () => {
    for (const key of PANEL_KEYS) CONFIG[key] = DEFAULTS[key];
    Music.setVolume(CONFIG.MUSIC_VOLUME);
    Music.setBpm(CONFIG.MUSIC_BPM);
    buildPanel();                      // and update the sliders to match
  };
}
