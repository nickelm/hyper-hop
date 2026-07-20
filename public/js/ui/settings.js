// ============================================================
// settings.js — the Control Panel (sliders and switches).
// ============================================================
// The gear button opens this. Every slider changes a CONFIG number
// live while you play (the game pauses while it's open). The ★ ones
// can be saved "for everyone" — those go to the server so all the
// tablets get them.

import { CONFIG, DEFAULTS } from "../config.js";
import { Music } from "../music.js";
import { apiWrite } from "../api.js";
import { showToast } from "./toast.js";

// The bit of the game the panel needs to know about (are we playing?
// which song?). main.js hands it over in initSettings().
let S = null;

// Each slider: [CONFIG name, label the kids see, smallest, biggest, step]
const PANEL_SLIDERS = [
  ["SCROLL_SPEED", "Scroll speed", 100, 800, 10],
  ["GRAVITY",      "Gravity",      1000, 14000, 100],
  ["JUMP_POWER",   "Jump power",   800, 3500, 50],
  ["PAD_POWER",    "Bounce pad power", 600, 2500, 50],
  ["SPIN_SPEED",   "Spin speed",   0, 900, 10],
  ["TILE",         "Tile size",    24, 64, 1],
  ["PLAYER_SIZE",  "Cube size",    16, 60, 1],
  ["SPIKE_MERCY",  "Spike mercy",  0, 0.5, 0.05],
  ["SCREEN_SHAKE", "Screen shake", 0, 30, 1],
  ["MUSIC_VOLUME", "Music volume", 0, 1, 0.05],
  ["MUSIC_BPM",    "Music speed (0 = each song's own)", 0, 200, 1],
];
// Each color picker: [CONFIG name, label]
const PANEL_COLORS = [
  ["PLAYER_COLOR", "Cube color"],
  ["SKY_TOP",      "Sky top color"],
  ["SKY_BOTTOM",   "Sky bottom color"],
];
// Each switch: [CONFIG name, label]
const PANEL_TOGGLES = [
  ["TRAIL", "Glowing trail"],
  ["SOUND", "Sound"],
  ["MUSIC", "Music"],
  ["BEAT_PULSE", "Beat pulse"],
];
// The settings that "Save for everyone" shares with all players (marked ★
// in the panel). Everything else in the panel is just for this visit.
const SHARED_KEYS = [
  "SCROLL_SPEED", "GRAVITY", "JUMP_POWER", "PAD_POWER", "SPIKE_MERCY",
  "PLAYER_COLOR", "SKY_TOP", "SKY_BOTTOM", "SOUND", "MUSIC", "MUSIC_BPM",
];
const sharedSet = new Set(SHARED_KEYS);
const star = key => (sharedSet.has(key) ? "★ " : "");

const panelControlsEl = document.getElementById("panelControls");
function buildPanel() {
  panelControlsEl.innerHTML = "";
  for (const [key, label, min, max, step] of PANEL_SLIDERS) {
    const wrap = document.createElement("div");
    wrap.className = "ctrl";
    wrap.innerHTML =
      '<div class="row"><span>' + star(key) + label + '</span><span class="val"></span></div>' +
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
  for (const [key, label] of PANEL_COLORS) {
    const wrap = document.createElement("div");
    wrap.className = "ctrl";
    wrap.innerHTML =
      '<div class="row"><span>' + star(key) + label + '</span></div>' +
      '<input type="color">';
    const picker = wrap.querySelector("input");
    picker.value = CONFIG[key];
    picker.addEventListener("input", () => { CONFIG[key] = picker.value; });
    panelControlsEl.appendChild(wrap);
  }
  for (const [key, label] of PANEL_TOGGLES) {
    const wrap = document.createElement("div");
    wrap.className = "ctrl toggle";
    wrap.innerHTML =
      '<label class="row"><span>' + star(key) + label + '</span>' +
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

// Put the live music settings back in step with CONFIG after a reset.
function applyMusicSettings() {
  Music.setVolume(CONFIG.MUSIC_VOLUME);
  Music.setBpm(CONFIG.MUSIC_BPM);
}

// Wire up the panel's buttons. main.js calls this once at startup.
export function initSettings(deps) {
  S = deps.S;

  document.getElementById("closePanelBtn").onclick = closePanel;

  // Reset just for me: back to the code defaults, this visit only.
  document.getElementById("resetCfgBtn").onclick = () => {
    Object.assign(CONFIG, DEFAULTS);   // put every number back the way it started
    applyMusicSettings();
    buildPanel();                      // and update the sliders to match
  };

  // Save for everyone: send the ★ settings to the server so every player gets them.
  document.getElementById("saveEveryoneBtn").onclick = async () => {
    const overrides = {};
    for (const k of SHARED_KEYS) overrides[k] = CONFIG[k];
    try {
      await apiWrite("PUT", "/settings", overrides);
      showToast("Saved for everyone!");
    } catch (e) { if (e.message !== "cancelled") showToast(e.message); }
  };

  // Reset for everyone: clear the server's shared settings and go back to defaults.
  document.getElementById("resetEveryoneBtn").onclick = async () => {
    try {
      await apiWrite("PUT", "/settings", {});
      Object.assign(CONFIG, DEFAULTS);
      applyMusicSettings();
      buildPanel();
      showToast("Reset for everyone!");
    } catch (e) { if (e.message !== "cancelled") showToast(e.message); }
  };
}
