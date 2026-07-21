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
import { initScrollbars } from "./scrollbars.js";

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
  messages: {},                   // what each  !  sign says: { "col,row": "HOLD to fly!" }
  tool: "#",
  cell: 24,                       // on-screen size of one editor square (worked out to fit)
  zoom: 0,                        // 0 = the whole level fits on screen; each step is one 🔍+ tap
  song: 0,                        // which tune (from music.js SONGS) this level plays
  theme: 0,                       // which background theme (from THEMES) this level uses
  editingId: null,                // the server level we're changing (null = a brand-new one)
  author: "",                     // who made this level (asked for on the first save)
};
function edInit() {
  ED.rows = CONFIG.LEVEL_ROWS;
  ED.grid = Array.from({ length: ED.rows }, () => Array(ED.cols).fill("."));
  ED.messages = {};
}
edInit();

// Load a level someone made earlier into the editor. Old levels were only a few
// rows tall, so we add empty sky on TOP until they're as tall as every level is
// now. The bottom row always stays on the floor, so nothing you built moves.
//
// The signs have to move down by those same rows, or every message would end up
// pointing at the wrong square.
function edLoadGrid(parsed, messages) {
  ED.cols = parsed.cols;
  ED.grid = parsed.grid.map(row => row.split(""));
  let addedRows = 0;
  while (ED.grid.length < CONFIG.LEVEL_ROWS) { ED.grid.unshift(Array(ED.cols).fill(".")); addedRows++; }
  ED.rows = ED.grid.length;
  ED.zoom = 0;                    // start by showing the whole level
  ED.messages = {};
  for (const [key, text] of Object.entries(messages || {})) {
    const [col, row] = key.split(",").map(Number);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    ED.messages[col + "," + (row + addedRows)] = text;
  }
}

// The editor palette. Tiles are shown in groups; a { sep: true } entry leaves a
// little gap so the new tiles read as their own family (platforms, boosts, etc.).
// Every button shows its NAME under the picture: an iPad has nothing to hover
// with, so a tooltip would never be seen. Keep the names short \u2014 they have to
// fit under a 58-pixel button.
const TOOLS = [
  { ch: ".", icon: "\u232B", label: "erase" },
  { ch: "#", icon: "\u2B1B", label: "block" },
  { ch: "/",  icon: "\u25E2", label: "up ramp" },    // \u25E2 filled lower-right triangle
  { ch: "\\", icon: "\u25E3", label: "down ramp" },  // \u25E3 filled lower-left triangle
  { ch: "L",  icon: "\u25e5", label: "up ramp \u2191" },   // \u25e5 upper-right triangle: a ceiling ramp
  { ch: "7",  icon: "\u25e4", label: "down ramp \u2191" }, // \u25e4 upper-left triangle: the other one
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
  { ch: ">", icon: "\u00bb", label: "faster" },       // \u00bb = speed up
  { ch: "<", icon: "\u00ab", label: "slower" },       // \u00ab = slow down
  { ch: "u", icon: "\u2191", label: "flip \u2191" },  // \u2191 = fall upward
  { ch: "n", icon: "\u2193", label: "normal \u2193" },  // \u2193 = fall down again
  { ch: "f", icon: "\u2708", label: "fly" },          // \u2708 wings = become a rocket (HOLD to climb)
  { ch: "c", icon: "\u25a0", label: "cube" },         // \u25a0 square = back to a normal cube
  { ch: "h", icon: "\u2715", label: "hole" },         // \u2715 = no ground, you fall out!
  { ch: "g", icon: "\u25ac", label: "ground on" },    // \u25ac = solid ground again
  { sep: true },                                      // ---- checkpoint and signs ----
  { ch: "@", icon: "\u2691", label: "checkpoint" },  // \u2691 flag = checkpoint
  { ch: "!", icon: "\ud83d\udcac", label: "sign" },  // \ud83d\udcac = a message for whoever plays
];
const paletteEl = document.getElementById("palette");
const tileBtns = [];
TOOLS.forEach(t => {
  if (t.sep) {                                        // a spacer between groups of tiles
    const s = document.createElement("div");
    s.className = "tileSep";
    paletteEl.appendChild(s);
    return;
  }
  const b = document.createElement("div");
  b.className = "tileBtn" + (t.ch === ED.tool ? " selected" : "");
  const icon = document.createElement("div");
  icon.className = "tileIcon"; icon.textContent = t.icon;
  const name = document.createElement("div");
  name.className = "tileLabel"; name.textContent = t.label;
  b.appendChild(icon); b.appendChild(name);
  b.onclick = () => {
    ED.tool = t.ch;
    tileBtns.forEach(c => c.classList.remove("selected"));
    b.classList.add("selected");
  };
  tileBtns.push(b);
  paletteEl.appendChild(b);
});

const eCanvas = document.getElementById("editorCanvas");
const eCtx = eCanvas.getContext("2d");
const eWrap = document.getElementById("editorGridWrap");

/* ----------------------------------------------------------------
   HOW BIG IS ONE SQUARE ON SCREEN?
   Tablets are all different sizes, so we don't pick a number — we
   work it out. At zoom 0 the WHOLE level is shrunk to fit the space
   we have, so it can never be cut off. Each tap on  🔍+  makes the
   squares bigger — as big as MAX_CELL, which is far past "the whole
   level fits", so you can get right in close to fiddle with one
   corner. Once the grid is bigger than the box you see it in, the
   scroll bars appear and you slide it around with them.
   ---------------------------------------------------------------- */
const MIN_CELL = 8, MAX_CELL = 72;
const ZOOM_STEP = 1.3;
const MAX_ZOOM = 10;             // how many times you can tap 🔍+
// A tablet gives up if you ask it to draw a picture bigger than this (it just
// goes blank), so a very WIDE level can't be zoomed in quite as far as a short
// one. Without this, zooming right in on a 300-square level would show nothing.
const MAX_CANVAS = 8192;

function fitCell() {
  // How much room the grid has. If the editor isn't on screen yet we
  // can't measure it, so fall back to a sensible middle size.
  const availW = eWrap.clientWidth - 20, availH = eWrap.clientHeight - 20;
  // (written this way so a missing measurement — NaN — falls back too)
  if (!(availW > 0) || !(availH > 0)) return 24;
  return Math.min(availW / ED.cols, availH / ED.rows);   // fit BOTH ways
}
function computeCell() {
  const wanted = fitCell() * Math.pow(ZOOM_STEP, ED.zoom);
  const biggest = Math.min(MAX_CELL, Math.floor(MAX_CANVAS / Math.max(ED.cols, ED.rows, 1)));
  return Math.max(MIN_CELL, Math.min(biggest, Math.floor(wanted)));
}

// Our own scroll bars (js/ui/scrollbars.js) — a finger on the canvas always
// paints, so these are how you move around a level that doesn't fit.
const bars = initScrollbars({
  wrap: eWrap,
  xBar: document.getElementById("edScrollX"),
  yBar: document.getElementById("edScrollY"),
});

function drawEditor() {
  ED.cell = computeCell();
  const c = ED.cell;
  eCanvas.width = ED.cols * c; eCanvas.height = ED.rows * c;
  eCtx.fillStyle = "#1a1a38"; eCtx.fillRect(0, 0, eCanvas.width, eCanvas.height);
  for (let r = 0; r < ED.rows; r++) for (let col = 0; col < ED.cols; col++) {
    const x = col * c, y = r * c, ch = ED.grid[r][col];
    eCtx.strokeStyle = "rgba(255,255,255,.08)"; eCtx.strokeRect(x, y, c, c);
    if (ch === "#") { eCtx.fillStyle = CONFIG.BLOCK_COLOR; eCtx.fillRect(x+2, y+2, c-4, c-4); }
    else if (ch === "/" || ch === "\\" || ch === "L" || ch === "7") {
      // the floor ramps ( / \ ) and their upside-down twins for the ceiling ( L 7 )
      eCtx.fillStyle = CONFIG.BLOCK_COLOR;
      eCtx.beginPath();
      if (ch === "/")       { eCtx.moveTo(x, y+c); eCtx.lineTo(x+c, y+c); eCtx.lineTo(x+c, y); }
      else if (ch === "\\") { eCtx.moveTo(x, y); eCtx.lineTo(x+c, y+c); eCtx.lineTo(x, y+c); }
      else if (ch === "L")  { eCtx.moveTo(x, y); eCtx.lineTo(x+c, y); eCtx.lineTo(x+c, y+c); }
      else                  { eCtx.moveTo(x, y); eCtx.lineTo(x+c, y); eCtx.lineTo(x, y+c); }
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
    else if (ch === "!") {   // a sign: a little board on a post (tap it to write on it)
      eCtx.fillStyle = "#8a8aa0";
      eCtx.fillRect(x+c/2-1, y+c/2, 3, c/2-3);
      eCtx.fillStyle = CONFIG.SIGN_COLOR;
      eCtx.fillRect(x+3, y+4, c-6, c/2-4);
      eCtx.strokeStyle = CONFIG.SIGN_TEXT_COLOR; eCtx.lineWidth = 2;
      eCtx.strokeRect(x+3, y+4, c-6, c/2-4);
      // a wiggle of "writing", so you can see at a glance which signs have words
      if (ED.messages[col + "," + r]) {
        eCtx.fillStyle = CONFIG.SIGN_TEXT_COLOR;
        eCtx.fillRect(x+6, y+8, c-12, 2);
        eCtx.fillRect(x+6, y+13, c-16, 2);
      }
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
    else if (ch === "h" || ch === "g") {   // a ground gate (grey hole / gold ground)
      eCtx.fillStyle = ch === "h" ? "#7b839e" : "#c9a227";
      eCtx.globalAlpha = 0.5; eCtx.fillRect(x+2, y+2, c-4, c-4); eCtx.globalAlpha = 1;
      eCtx.fillStyle = "#fff"; eCtx.font = "bold 18px Trebuchet MS"; eCtx.textAlign = "center";
      eCtx.fillText(ch === "h" ? "✕" : "▬", x+c/2, y+c/2+6); eCtx.textAlign = "left";
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
  bars.refresh();                        // the grid changed size — move the scroll bars to match
}

// Paint one square. A finger dragged across the grid comes through here over
// and over, which is how you draw a whole row of blocks in one go.
//
// `firstTouch` is true only for the square you press on. That's the one a sign
// asks you to write on — otherwise dragging a row of signposts would pop the
// keyboard up over and over.
function edPaint(e, firstTouch) {
  const rect = eCanvas.getBoundingClientRect();
  const col = Math.floor((e.clientX - rect.left) / ED.cell);
  const r   = Math.floor((e.clientY - rect.top) / ED.cell);
  if (r < 0 || r >= ED.rows || col < 0 || col >= ED.cols) return;
  // Dragging a finger sends this square after square; redrawing the whole grid
  // for one that is ALREADY what you're painting would just make it stutter.
  if (ED.grid[r][col] === ED.tool && ED.tool !== "!") return;
  ED.grid[r][col] = ED.tool;
  // Painting over a square wipes the sign that used to be there, so a message
  // can never be left behind pointing at a block.
  if (ED.tool !== "!") delete ED.messages[col + "," + r];
  drawEditor();
  if (ED.tool === "!" && firstTouch) openSignBox(col, r);   // what should this sign say?
}

/* ----------------------------------------------------------------
   DRAWING WITH A FINGER. A finger on the grid always paints — never
   slides — because the scroll bars are what moves the view. To make
   long runs easy anyway, painting right at the edge of the box keeps
   the grid sliding underneath your finger.
   ---------------------------------------------------------------- */
const EDGE = 40;                 // how close to the edge starts the sliding (pixels)
const EDGE_SCROLL_SPEED = 12;    // how far it slides each frame

let painting = false;
let lastPoint = null;            // where the finger is right now (for the edge sliding)
let edgeTimer = null;

function edgeScrollStep() {
  edgeTimer = null;
  if (!painting || !lastPoint) return;
  const r = eWrap.getBoundingClientRect();
  let dx = 0, dy = 0;
  if (lastPoint.x < r.left + EDGE)   dx = -EDGE_SCROLL_SPEED;
  if (lastPoint.x > r.right - EDGE)  dx =  EDGE_SCROLL_SPEED;
  if (lastPoint.y < r.top + EDGE)    dy = -EDGE_SCROLL_SPEED;
  if (lastPoint.y > r.bottom - EDGE) dy =  EDGE_SCROLL_SPEED;
  if (dx || dy) {
    eWrap.scrollLeft += dx; eWrap.scrollTop += dy;
    edPaint(lastPoint);                       // keep painting as the grid slides by
  }
  edgeTimer = requestAnimationFrame(edgeScrollStep);
}
function startPainting(e) {
  painting = true;
  lastPoint = { clientX: e.clientX, clientY: e.clientY, x: e.clientX, y: e.clientY };
  if (edgeTimer === null) edgeTimer = requestAnimationFrame(edgeScrollStep);
}
function stopPainting() {
  painting = false; lastPoint = null;
  if (edgeTimer !== null) { cancelAnimationFrame(edgeTimer); edgeTimer = null; }
}

eCanvas.addEventListener("pointerdown", e => {
  e.preventDefault(); e.stopPropagation();
  eCanvas.setPointerCapture(e.pointerId);
  startPainting(e); edPaint(e, true);
});
eCanvas.addEventListener("pointermove", e => {
  if (!painting) return;
  lastPoint = { clientX: e.clientX, clientY: e.clientY, x: e.clientX, y: e.clientY };
  edPaint(e);
});
eCanvas.addEventListener("pointerup", stopPainting);
eCanvas.addEventListener("pointercancel", stopPainting);
window.addEventListener("pointerup", stopPainting);

/* ----------------------------------------------------------------
   SIGNS. A  !  square is a signpost; what it SAYS is kept in
   ED.messages, in a little list of "column,row" → the words. Tap a
   sign with the 💬 tool to write on it (or to change it later).
   ---------------------------------------------------------------- */
const signBox = document.getElementById("messageBox");
const signInput = document.getElementById("messageInput");
let signSquare = null;             // "col,row" of the sign we're writing on

function openSignBox(col, row) {
  signSquare = col + "," + row;
  signInput.value = ED.messages[signSquare] || "";
  signBox.classList.remove("hidden");
  setTimeout(() => signInput.focus(), 50);
}
function closeSignBox() { signBox.classList.add("hidden"); signSquare = null; }

document.getElementById("messageOkBtn").onclick = () => {
  if (signSquare === null) return;
  const words = signInput.value.trim();
  if (words) ED.messages[signSquare] = words;
  else delete ED.messages[signSquare];     // no words = just an empty signpost
  closeSignBox(); drawEditor();
};
// "Remove" takes the whole sign away — the words AND the post.
document.getElementById("messageDeleteBtn").onclick = () => {
  if (signSquare === null) return;
  const [col, row] = signSquare.split(",").map(Number);
  delete ED.messages[signSquare];
  if (ED.grid[row] && ED.grid[row][col] === "!") ED.grid[row][col] = ".";
  closeSignBox(); drawEditor();
};
document.getElementById("messageCancelBtn").onclick = closeSignBox;

/* ----------------------------------------------------------------
   ZOOM. Tapping 🔍+ / 🔍− keeps whatever you were looking at in the
   middle of the box, instead of throwing you back to the top-left
   corner of the level.
   ---------------------------------------------------------------- */
function zoomBy(step) {
  // where the middle of the view is, as a fraction of the whole grid (0..1)
  const midX = (eWrap.scrollLeft + eWrap.clientWidth / 2) / Math.max(1, eCanvas.width);
  const midY = (eWrap.scrollTop + eWrap.clientHeight / 2) / Math.max(1, eCanvas.height);
  const before = ED.cell;
  const wanted = Math.max(0, Math.min(MAX_ZOOM, ED.zoom + step));
  if (wanted === ED.zoom) return;
  ED.zoom = wanted;
  drawEditor();
  // Nothing actually got bigger? Then this is as close as this tablet can draw
  // (see MAX_CANVAS) — put the zoom back, so 🔍− works on the very next tap.
  if (step > 0 && ED.cell === before) { ED.zoom -= step; drawEditor(); return; }
  eWrap.scrollLeft = midX * eCanvas.width - eWrap.clientWidth / 2;
  eWrap.scrollTop  = midY * eCanvas.height - eWrap.clientHeight / 2;
  bars.refresh();
}
document.getElementById("zoomInBtn").onclick = () => {
  if (ED.zoom >= MAX_ZOOM || ED.cell >= MAX_CELL) return;
  zoomBy(1);
};
document.getElementById("zoomOutBtn").onclick = () => {
  if (ED.zoom <= 0) return;              // 0 = the whole level already fits
  zoomBy(-1);
};
window.addEventListener("resize", () => { if (S && S.screen === "editor") drawEditor(); });

document.getElementById("widerBtn").onclick = () => {
  ED.cols += 10; ED.grid.forEach(row => { for (let i = 0; i < 10; i++) row.push("."); });
  drawEditor();
};
document.getElementById("narrowBtn").onclick = () => {
  if (ED.cols <= 20) return;
  ED.cols -= 10; ED.grid.forEach(row => row.length = ED.cols);
  // any signs in the part we just cut off go with it
  for (const key of Object.keys(ED.messages)) {
    if (Number(key.split(",")[0]) >= ED.cols) delete ED.messages[key];
  }
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
  startLevel(parseLevel(edToText(), ED.messages), true, false, ED.song, ED.theme);
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
  // The signs ride along as one extra line. A level with no signs doesn't
  // get the line at all, so the code looks just like it always did.
  const signs = Object.keys(ED.messages).length
    ? "  messages: " + JSON.stringify(ED.messages) + ",\n" : "";
  document.getElementById("exportText").value =
    "{\n  name: \"" + escapeName(levelName()) + "\",\n  song: " + ED.song +
    ",\n  theme: " + ED.theme + ",\n" + signs +
    "  level: `\n" + edToText() + "\n`,\n},";
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
  // And the signs, if there are any. Code pasted from before signs existed
  // simply doesn't have this line, and that's fine.
  const signsMatch = text.match(/messages:\s*(\{[^}]*\})/);
  let signs = {};
  if (signsMatch) { try { signs = JSON.parse(signsMatch[1]); } catch (e) { signs = {}; } }
  // If there is a `...` grid block, use only what's inside the backticks.
  const first = text.indexOf("`"), last = text.lastIndexOf("`");
  const gridText = (first !== -1 && last > first) ? text.slice(first + 1, last) : text;

  const parsed = parseLevel(gridText);
  if (parsed.rows === 0 || parsed.cols === 0) { showToast("Couldn't read that"); return; }

  edLoadGrid(parsed, signs);
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
  const body = { name: levelName(), author: ED.author, level: edToText(),
                 song: ED.song, theme: ED.theme, messages: ED.messages };
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
  edLoadGrid(parsed, L.messages);
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
