// ============================================================
// editor.js — the level editor.
// ============================================================
// The grid you paint levels on: the tile palette, drawing with a
// finger, the tune and theme buttons, test-playing, copy/paste level
// code, and saving to the server.
//
// It owns ED (the level being edited). main.js gives it the few things
// it needs: where we are (S), how to change page, how to start a test
// play, who's playing, and what to do after a save.

import { CONFIG, THEMES } from "../config.js";
import { parseLevel } from "../game/level.js";
import { Music, SONGS } from "../music.js";
import { apiWrite } from "../api.js";
import { showToast } from "./toast.js";

// Filled in by initEditor().
let S = null;
let showScreen = () => {};
let startLevel = () => {};
let getPlayerName = () => "";
let onSaved = async () => {};

export function initEditor(deps) {
  S = deps.S;
  showScreen = deps.showScreen;
  startLevel = deps.startLevel;
  getPlayerName = deps.getPlayerName;
  onSaved = deps.onSaved;
}

const ED = {
  rows: CONFIG.LEVEL_ROWS, cols: 40,
  grid: [],
  tool: "#",
  cell: 34,                       // on-screen size of one editor cell
  song: 0,                        // which tune (from music.js SONGS) this level plays
  theme: 0,                       // which background theme (from THEMES) this level uses
  editingId: null,                // the server level we're changing (null = a brand-new one)
  author: "",                     // who made this level (asked for on the first save)
};
function edInit() {
  ED.rows = CONFIG.LEVEL_ROWS;
  ED.grid = Array.from({ length: ED.rows }, () => Array(ED.cols).fill("."));
}
edInit();

// Load a level someone made earlier into the editor. Old levels were only a few
// rows tall, so we add empty sky on TOP until they're as tall as every level is
// now. The bottom row always stays on the floor, so nothing you built moves.
function edLoadGrid(parsed) {
  ED.cols = parsed.cols;
  ED.grid = parsed.grid.map(row => row.split(""));
  while (ED.grid.length < CONFIG.LEVEL_ROWS) ED.grid.unshift(Array(ED.cols).fill("."));
  ED.rows = ED.grid.length;
}

// The editor palette. Tiles are shown in groups; a { sep: true } entry leaves a
// little gap so the new tiles read as their own family (platforms, boosts, etc.).
const TOOLS = [
  { ch: ".", icon: "\u232B", label: "erase" },
  { ch: "#", icon: "\u2B1B", label: "block" },
  { ch: "/",  icon: "\u25E2", label: "up ramp" },    // \u25E2 filled lower-right triangle
  { ch: "\\", icon: "\u25E3", label: "down ramp" },  // \u25E3 filled lower-left triangle
  { ch: "^", icon: "\u25B2", label: "spike" },
  { ch: "o", icon: "\u2B24", label: "pad" },
  { ch: "*", icon: "\u2605", label: "coin" },
  { ch: "|", icon: "\uD83C\uDFC1", label: "finish" },
  { sep: true },                                      // ---- platforms ----
  { ch: "=", icon: "\u2550", label: "platform" },    // \u2550 double line = jump-through platform
  { ch: "-", icon: "\u2509", label: "bridge" },      // \u2509 dashed line = disappearing bridge
  { sep: true },                                      // ---- boosts ----
  { ch: "p", icon: "\u2022", label: "small pad" },   // \u2022 small dot = little pink pad
  { ch: "U", icon: "\u222a", label: "catapult" },    // \u222a bucket = catapult
  { sep: true },                                      // ---- hazards ----
  { ch: "s", icon: "\u2699", label: "saw" },         // \u2699 gear = spinning saw blade
  { sep: true },                                      // ---- portals ----
  { ch: ">", icon: "\u00bb", label: "fast portal" },  // \u00bb = speed up
  { ch: "<", icon: "\u00ab", label: "slow portal" },  // \u00ab = slow down
  { ch: "u", icon: "\u2191", label: "flip gravity" }, // \u2191 = fall upward
  { ch: "n", icon: "\u2193", label: "normal gravity" }, // \u2193 = fall down again
  { ch: "f", icon: "\u2708", label: "fly portal" },   // \u2708 wings = become a rocket (HOLD to climb)
  { ch: "c", icon: "\u25a0", label: "cube portal" },  // \u25a0 square = back to a normal cube
  { sep: true },                                      // ---- checkpoint ----
  { ch: "@", icon: "\u2691", label: "checkpoint" },  // \u2691 flag = checkpoint
];
const paletteEl = document.getElementById("palette");
TOOLS.forEach(t => {
  if (t.sep) {                                        // a spacer between groups of tiles
    const s = document.createElement("div");
    s.className = "tileSep";
    paletteEl.appendChild(s);
    return;
  }
  const b = document.createElement("div");
  b.className = "tileBtn" + (t.ch === ED.tool ? " selected" : "");
  b.textContent = t.icon; b.title = t.label;
  b.onclick = () => {
    ED.tool = t.ch;
    [...paletteEl.children].forEach(c => c.classList.remove("selected"));
    b.classList.add("selected");
  };
  paletteEl.appendChild(b);
});

const eCanvas = document.getElementById("editorCanvas");
const eCtx = eCanvas.getContext("2d");
function drawEditor() {
  const c = ED.cell;
  eCanvas.width = ED.cols * c; eCanvas.height = ED.rows * c;
  eCtx.fillStyle = "#1a1a38"; eCtx.fillRect(0, 0, eCanvas.width, eCanvas.height);
  for (let r = 0; r < ED.rows; r++) for (let col = 0; col < ED.cols; col++) {
    const x = col * c, y = r * c, ch = ED.grid[r][col];
    eCtx.strokeStyle = "rgba(255,255,255,.08)"; eCtx.strokeRect(x, y, c, c);
    if (ch === "#") { eCtx.fillStyle = CONFIG.BLOCK_COLOR; eCtx.fillRect(x+2, y+2, c-4, c-4); }
    else if (ch === "/" || ch === "\\") {
      eCtx.fillStyle = CONFIG.BLOCK_COLOR;
      eCtx.beginPath();
      if (ch === "/") { eCtx.moveTo(x, y+c); eCtx.lineTo(x+c, y+c); eCtx.lineTo(x+c, y); }
      else            { eCtx.moveTo(x, y); eCtx.lineTo(x+c, y+c); eCtx.lineTo(x, y+c); }
      eCtx.closePath(); eCtx.fill();
    }
    else if (ch === "^") {
      eCtx.fillStyle = CONFIG.SPIKE_COLOR;
      eCtx.beginPath(); eCtx.moveTo(x+c/2, y+3); eCtx.lineTo(x+c-3, y+c-3); eCtx.lineTo(x+3, y+c-3);
      eCtx.closePath(); eCtx.fill();
    }
    else if (ch === "o") { eCtx.fillStyle = CONFIG.PAD_COLOR; eCtx.fillRect(x+4, y+c-10, c-8, 6); }
    else if (ch === "*") { eCtx.fillStyle = CONFIG.COIN_COLOR; eCtx.beginPath(); eCtx.arc(x+c/2, y+c/2, c/3, 0, 7); eCtx.fill(); }
    else if (ch === "|") { eCtx.fillStyle = "#fff"; eCtx.fillRect(x+c/2-2, y+2, 4, c-4); }
    else if (ch === "=") { eCtx.fillStyle = CONFIG.BLOCK_COLOR; eCtx.fillRect(x+2, y+2, c-4, c/3); }
    else if (ch === "-") {   // three little planks with gaps = a bridge
      eCtx.fillStyle = CONFIG.BLOCK_COLOR;
      const plank = (c - 8) / 3;
      for (let p = 0; p < 3; p++) eCtx.fillRect(x + 2 + p * (plank + 2), y + 2, plank, c/3);
    }
    else if (ch === "p") { eCtx.fillStyle = CONFIG.SMALL_PAD_COLOR; eCtx.fillRect(x+c/3, y+c-8, c/3, 5); }
    else if (ch === "s") { eCtx.fillStyle = CONFIG.SPIKE_COLOR; eCtx.beginPath(); eCtx.arc(x+c/2, y+c/2, c*CONFIG.SAW_RADIUS, 0, 7); eCtx.fill(); }
    else if (ch === "@") {   // a little checkpoint flag
      eCtx.strokeStyle = "#fff"; eCtx.lineWidth = 2;
      eCtx.beginPath(); eCtx.moveTo(x+c/2, y+c-3); eCtx.lineTo(x+c/2, y+4); eCtx.stroke();
      eCtx.fillStyle = "#7dff5e";
      eCtx.beginPath(); eCtx.moveTo(x+c/2, y+4); eCtx.lineTo(x+c/2+10, y+9); eCtx.lineTo(x+c/2, y+14); eCtx.closePath(); eCtx.fill();
    }
    else if (ch === ">" || ch === "<") {   // a speed portal (green fast / blue slow)
      eCtx.fillStyle = ch === ">" ? "#3dff7a" : "#3aa0ff";
      eCtx.globalAlpha = 0.5; eCtx.fillRect(x+2, y+2, c-4, c-4); eCtx.globalAlpha = 1;
      eCtx.fillStyle = "#fff"; eCtx.font = "bold 18px Trebuchet MS"; eCtx.textAlign = "center";
      eCtx.fillText(ch === ">" ? "»" : "«", x+c/2, y+c/2+6); eCtx.textAlign = "left";
    }
    else if (ch === "u" || ch === "n") {   // a gravity portal (purple flip / cyan normal)
      eCtx.fillStyle = ch === "u" ? "#b06bff" : "#3ff0ff";
      eCtx.globalAlpha = 0.5; eCtx.fillRect(x+2, y+2, c-4, c-4); eCtx.globalAlpha = 1;
      eCtx.fillStyle = "#fff"; eCtx.font = "bold 18px Trebuchet MS"; eCtx.textAlign = "center";
      eCtx.fillText(ch === "u" ? "↑" : "↓", x+c/2, y+c/2+6); eCtx.textAlign = "left";
    }
    else if (ch === "f" || ch === "c") {   // a flight portal (orange rocket / green cube)
      eCtx.fillStyle = ch === "f" ? "#ff9a3d" : "#7dff5e";
      eCtx.globalAlpha = 0.5; eCtx.fillRect(x+2, y+2, c-4, c-4); eCtx.globalAlpha = 1;
      eCtx.fillStyle = "#fff"; eCtx.font = "bold 18px Trebuchet MS"; eCtx.textAlign = "center";
      eCtx.fillText(ch === "f" ? "✈" : "■", x+c/2, y+c/2+6); eCtx.textAlign = "left";
    }
    else if (ch === "U") {   // a little yellow bucket
      eCtx.fillStyle = CONFIG.CATAPULT_COLOR;
      eCtx.fillRect(x+3, y+c-6, c-6, 4);            // base
      eCtx.fillRect(x+3, y+c/3, 4, c-c/3);          // left wall
      eCtx.fillRect(x+c-7, y+c/3, 4, c-c/3);        // right wall
    }
  }
  // floor hint
  eCtx.fillStyle = "rgba(255,255,255,.5)";
  eCtx.fillRect(0, eCanvas.height - 2, eCanvas.width, 2);
}
function edPaint(e) {
  const rect = eCanvas.getBoundingClientRect();
  const col = Math.floor((e.clientX - rect.left) / ED.cell);
  const r   = Math.floor((e.clientY - rect.top) / ED.cell);
  if (r < 0 || r >= ED.rows || col < 0 || col >= ED.cols) return;
  ED.grid[r][col] = ED.tool;
  drawEditor();
}
let painting = false;
eCanvas.addEventListener("pointerdown", e => { painting = true; edPaint(e); e.stopPropagation(); });
eCanvas.addEventListener("pointermove", e => { if (painting) edPaint(e); });
window.addEventListener("pointerup", () => painting = false);

document.getElementById("widerBtn").onclick = () => {
  ED.cols += 10; ED.grid.forEach(row => { for (let i = 0; i < 10; i++) row.push("."); });
  drawEditor();
};
document.getElementById("narrowBtn").onclick = () => {
  if (ED.cols <= 20) return;
  ED.cols -= 10; ED.grid.forEach(row => row.length = ED.cols);
  drawEditor();
};
document.getElementById("clearBtn").onclick = () => { edInit(); drawEditor(); };
document.getElementById("editorBackBtn").onclick = () => { Music.stop(); S.screen = "menu"; showScreen("menuScreen"); };

// The Tune button shows the current song's name. Tap it to switch to the next
// tune, and it plays a little preview so you can hear which one you picked.
const tuneBtn = document.getElementById("tuneBtn");
function updateTuneBtn() { tuneBtn.textContent = "♪ " + SONGS[ED.song].name; }
tuneBtn.onclick = () => {
  ED.song = (ED.song + 1) % SONGS.length;
  updateTuneBtn();
  if (CONFIG.MUSIC) Music.start(ED.song, CONFIG.MUSIC_VOLUME);   // hear the new tune
};
updateTuneBtn();

// The Theme button shows the current background theme. Tap it to switch to the
// next one. You'll see how it looks when you tap Play.
const themeBtn = document.getElementById("themeBtn");
function updateThemeBtn() { themeBtn.textContent = "🎨 " + THEMES[ED.theme].name; }
themeBtn.onclick = () => {
  ED.theme = (ED.theme + 1) % THEMES.length;
  updateThemeBtn();
};
updateThemeBtn();

function edToText() {
  return ED.grid.map(row => row.join("")).join("\n");
}
document.getElementById("playTestBtn").onclick = () => {
  startLevel(parseLevel(edToText()), true, false, ED.song, ED.theme);
};
// Make the level's name safe to drop inside "..." in the exported code,
// so a name with a quote in it can't break things.
function escapeName(name) {
  return name.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
function levelName() {
  const n = document.getElementById("levelNameInput").value.trim();
  return n === "" ? "My Level" : n;
}
document.getElementById("copyBtn").onclick = () => {
  document.getElementById("exportText").value =
    "{\n  name: \"" + escapeName(levelName()) + "\",\n  song: " + ED.song +
    ",\n  theme: " + ED.theme +
    ",\n  level: `\n" + edToText() + "\n`,\n},";
  document.getElementById("exportBox").classList.remove("hidden");
};
document.getElementById("closeExportBtn").onclick = () => document.getElementById("exportBox").classList.add("hidden");
document.getElementById("copyForRealBtn").onclick = async () => {
  const txt = document.getElementById("exportText").value;
  try { await navigator.clipboard.writeText(txt); }
  catch (e) { document.getElementById("exportText").select(); document.execCommand("copy"); }
  showToast("Copied!");
};


// Import: take level code the kid pasted and load it back into the editor.
// It understands the full copied code (with the name and the `...` grid) OR
// just a plain grid on its own.
function importLevel(text) {
  // If there is a name in the pasted code, grab it. Otherwise keep the current name.
  const nameMatch = text.match(/name:\s*"((?:[^"\\]|\\.)*)"/);
  // If there is a song number in the pasted code, grab it too.
  const songMatch = text.match(/song:\s*(\d+)/);
  // And the theme number, if it's there.
  const themeMatch = text.match(/theme:\s*(\d+)/);
  // If there is a `...` grid block, use only what's inside the backticks.
  const first = text.indexOf("`"), last = text.lastIndexOf("`");
  const gridText = (first !== -1 && last > first) ? text.slice(first + 1, last) : text;

  const parsed = parseLevel(gridText);
  if (parsed.rows === 0 || parsed.cols === 0) { showToast("Couldn't read that"); return; }

  edLoadGrid(parsed);
  if (nameMatch) {
    document.getElementById("levelNameInput").value =
      nameMatch[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  if (songMatch) { ED.song = Number(songMatch[1]) % SONGS.length; updateTuneBtn(); }
  if (themeMatch) { ED.theme = Number(themeMatch[1]) % THEMES.length; updateThemeBtn(); }
  document.getElementById("importBox").classList.add("hidden");
  drawEditor();
}
document.getElementById("importBtn").onclick = () => {
  document.getElementById("importText").value = "";
  document.getElementById("importBox").classList.remove("hidden");
};
document.getElementById("loadBtn").onclick = () => importLevel(document.getElementById("importText").value);
document.getElementById("closeImportBtn").onclick = () => document.getElementById("importBox").classList.add("hidden");

/* ================================================================
   ====================  SAVE TO THE SERVER  =======================
   ================================================================
   "Save to server" sends the level to server.js so everyone can play
   it. The first time you save a new level we ask for a name and who
   made it; after that (and when editing an existing level) it just saves. */

// Actually send the current editor level to the server, then refresh the menu.
async function saveToServer() {
  const body = { name: levelName(), author: ED.author, level: edToText(), song: ED.song, theme: ED.theme };
  try {
    let created = null;
    if (ED.editingId != null) {
      await apiWrite("PUT", "/levels/" + ED.editingId, body);
    } else {
      created = await apiWrite("POST", "/levels", body);
      ED.editingId = created.id;         // from now on, saving updates this same level
    }
    showToast("Saved!");
    // `created` carries the new-level bounty (if any) so main.js can
    // cheer about it and update the purse.
    await onSaved(created);   // main.js refreshes its level list and the menu
  } catch (e) {
    showToast(e.message);
  }
}

// The Save-pop-up: collects the name + author for a brand-new level. The author
// is pre-filled with this tablet's player, so usually you just tap Save.
function openSaveModal() {
  document.getElementById("saveNameInput").value = levelName();
  document.getElementById("saveAuthorInput").value = ED.author || getPlayerName() || "";
  document.getElementById("saveBox").classList.remove("hidden");
  // If we already know the author, jump to the name box instead.
  const focusId = (ED.author || getPlayerName()) ? "saveNameInput" : "saveAuthorInput";
  setTimeout(() => document.getElementById(focusId).focus(), 50);
}
document.getElementById("saveServerBtn").onclick = () => {
  // Ask for name + author on a brand-new level; otherwise save straight away.
  if (ED.editingId == null || !ED.author) openSaveModal();
  else saveToServer();
};
document.getElementById("saveConfirmBtn").onclick = () => {
  const name = document.getElementById("saveNameInput").value.trim() || "My Level";
  const author = document.getElementById("saveAuthorInput").value.trim();
  if (!author) { showToast("Please type who made it."); return; }
  document.getElementById("levelNameInput").value = name;
  ED.author = author;
  document.getElementById("saveBox").classList.add("hidden");
  saveToServer();
};
document.getElementById("saveCancelBtn").onclick = () => document.getElementById("saveBox").classList.add("hidden");

// Open a level from the menu for editing: load its grid, name, tune and theme
// into the editor and show it.
export function openLevelForEdit(L) {
  const parsed = parseLevel(L.level);
  edLoadGrid(parsed);
  ED.editingId = L.id;                              // remember WHICH level we're changing
  ED.author = L.author || "";
  ED.song = (L.song != null) ? (Number(L.song) % SONGS.length) : 0;
  ED.theme = (L.theme != null) ? (Number(L.theme) % THEMES.length) : 0;
  document.getElementById("levelNameInput").value = L.name;
  updateTuneBtn();
  updateThemeBtn();
  S.screen = "editor"; showScreen("editorScreen"); drawEditor();
}

// Start a brand-new, empty level. If this tablet knows who's playing, that's
// the author already — no need to ask.
export function openNewLevel() {
  ED.editingId = null; ED.author = getPlayerName() || "";
  S.screen = "editor"; showScreen("editorScreen"); drawEditor();
}
