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
import { apiWrite, askConfirm } from "../api.js";
import { maxCoinsPerLevel } from "../economy.js";
import { LEVEL_RULES, countRules } from "../rules.js";
import { showToast } from "./toast.js";
import { initScrollbars } from "./scrollbars.js";

// Filled in by initEditor().
let S = null;
let showScreen = () => {};
let startLevel = () => {};
let getPlayerName = () => "";
let onSaved = async () => {};
let editLook = () => {};

export function initEditor(deps) {
  S = deps.S;
  showScreen = deps.showScreen;
  startLevel = deps.startLevel;
  getPlayerName = deps.getPlayerName;
  onSaved = deps.onSaved;
  editLook = deps.editLook;      // opens the cube editor to design this level's look
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
  reward: null,                   // the look this level is played as: {name, skin} (null = none)
  rules: {},                      // the numbers this level changes: { GRAVITY: 1500 } ({} = plays normally)
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
  { ch: "v", icon: "\u25BC", label: "spike \u2191" },  // \u25BC down triangle: a spike hanging from the roof
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
    updateCoinCount();            // the coin counter only shows while you hold the coin
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
    else if (ch === "^" || ch === "v") {
      // a floor spike, and its upside-down twin that hangs from the roof
      eCtx.fillStyle = CONFIG.SPIKE_COLOR;
      eCtx.beginPath();
      if (ch === "^") { eCtx.moveTo(x+c/2, y+3);   eCtx.lineTo(x+c-3, y+c-3); eCtx.lineTo(x+3, y+c-3); }
      else            { eCtx.moveTo(x+c/2, y+c-3); eCtx.lineTo(x+c-3, y+3);   eCtx.lineTo(x+3, y+3); }
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
  updateCoinCount();
}

/* ----------------------------------------------------------------
   HOW MANY COINS? A level may only hold so many (the server decides
   how many — see maxCoinsPerLevel in economy.js), so nobody can
   carpet a level in coins and make a coin machine out of it.

   "The FIRST coin" always means the same thing here: the one you'd
   meet first running right — leftmost column first, and top to bottom
   within a column. Both the auto-remove while you draw and the trim
   when you save ask firstCoin(), so the two can never disagree.
   ---------------------------------------------------------------- */
function countCoins() {
  let n = 0;
  for (const row of ED.grid) for (const ch of row) if (ch === "*") n++;
  return n;
}
function firstCoin() {
  for (let col = 0; col < ED.cols; col++) {
    for (let r = 0; r < ED.rows; r++) {
      if (ED.grid[r] && ED.grid[r][col] === "*") return { col, r };
    }
  }
  return null;
}
function removeFirstCoin() {
  const coin = firstCoin();
  if (coin) ED.grid[coin.r][coin.col] = ".";
}

// The little "★ 7 / 25" chip next to the level's name. It shows while you
// hold the coin tool — and also whenever a level has too many coins, so an
// older level over the limit says so the moment you open it.
const coinCountEl = document.getElementById("coinCount");
function updateCoinCount() {
  const most = maxCoinsPerLevel();
  const have = countCoins();
  coinCountEl.textContent = "★ " + have + " / " + most;
  coinCountEl.classList.toggle("over", have > most);
  coinCountEl.classList.toggle("hidden", ED.tool !== "*" && have <= most);
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
  // One coin too many? Take the FIRST coin away and put this one down instead,
  // so drawing never stops with an error. Only once per finger-stroke, though:
  // otherwise dragging along at the limit would drag the level's coins with you.
  if (ED.tool === "*" && countCoins() >= maxCoinsPerLevel()) {
    if (swappedThisStroke) return;                  // already swapped one — lift your finger
    removeFirstCoin();
    swappedThisStroke = true;
    showToast("Coin limit (" + maxCoinsPerLevel() + ") — removed the first coin");
  }
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
// Has this one stroke already swapped a coin for the level's first one? (See
// edPaint — one swap per stroke, so a drag can't eat a whole row of coins.)
let swappedThisStroke = false;

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
  swappedThisStroke = false;     // a fresh stroke may swap one coin again
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
/* ----------------------------------------------------------------
   DO THE BOTTOM BUTTONS STILL FIT?
   Play, Save, Menu and friends live along the bottom of the editor,
   and they must ALWAYS be tappable. index.html already promises they
   are never squeezed off, but a very short screen — a tablet lying
   down, a small window, or a browser that is itself zoomed in — can
   still push them out of sight. A style rule can't tell when the
   browser is zoomed, so instead we MEASURE where the buttons actually
   ended up, and if they're off the screen we make everything smaller.
   Exactly two goes at it, never a loop, so this can never spin.
   ---------------------------------------------------------------- */
const MIN_GRID_HEIGHT = 90;     // always leave at least this much room for the level itself
const eScreen = document.getElementById("editorScreen");
const eTop = document.getElementById("editorTop");
const eBottom = document.getElementById("editorBottom");

// Is the bottom of that row still above the bottom of the screen?
function fitsOnScreen(el) {
  const box = el.getBoundingClientRect();
  return !(box.bottom > window.innerHeight + 1);
}
function checkEditorFits() {
  // Start from "everything normal size", in case the tablet was just turned
  // the other way round and there's plenty of room again.
  eScreen.classList.remove("compact");
  eTop.style.maxHeight = "";
  if (fitsOnScreen(eBottom)) return;

  eScreen.classList.add("compact");        // try 1: smaller tiles and buttons
  if (fitsOnScreen(eBottom)) return;

  // try 2: still no room, so put a lid on the row of tiles — it scrolls
  // inside itself, and the buttons come back onto the screen.
  const room = window.innerHeight - eBottom.getBoundingClientRect().height - MIN_GRID_HEIGHT;
  if (room > 0) eTop.style.maxHeight = room + "px";
}

// Fit the editor to the screen, then draw the level in whatever space is left.
// Exported so main.js can call it when you come BACK from testing your level —
// the tablet may have been turned round while you were playing.
export function layoutEditor() { checkEditorFits(); drawEditor(); }

window.addEventListener("resize", () => { if (S && S.screen === "editor") layoutEditor(); });

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

/* ----------------------------------------------------------------
   THE LEVEL'S LOOK. A level can be played as its own character — "The
   Crow Flies" is played as The Crow, by everybody, every time — and
   whoever finishes it keeps that cube forever.

   The cube itself is designed in the CUBE editor, because that's the
   page that already knows how to build one. We just hand it over and
   take the answer back: `editLook` (from main.js) opens it, and calls
   us back with the new look, with null for "this level hasn't got one",
   or not at all if the kid tapped Back.
   ---------------------------------------------------------------- */
const lookBtn = document.getElementById("lookBtn");
function updateLookBtn() {
  lookBtn.textContent = "🎭 " + (ED.reward ? ED.reward.name : "No look");
}
lookBtn.onclick = () => {
  editLook(ED.reward, reward => { ED.reward = reward; updateLookBtn(); });
};
updateLookBtn();

/* ----------------------------------------------------------------
   THE LEVEL'S RULES. A level can bend a few of the game's numbers
   while you are inside it: moon gravity, a giant jump, a fiercer
   rocket. Which numbers, and how far each may go, is the LEVEL_RULES
   list in js/rules.js — this pop-up builds itself from that list, so
   adding a number there makes a new slider appear here by itself.

   A slider you have never touched says "normal" and is NOT saved.
   Only the numbers you actually moved ride along with the level, so a
   level that plays normally carries nothing at all.
   ---------------------------------------------------------------- */
const rulesBtn = document.getElementById("rulesBtn");
const rulesBox = document.getElementById("rulesBox");
const rulesListEl = document.getElementById("rulesList");

function updateRulesBtn() {
  const n = countRules(ED.rules);
  rulesBtn.textContent = "⚙ Rules" + (n ? " " + n : "");
}

// Draw one row per number: its name, what it's set to (or "normal"), a
// slider, and a ↺ to put it back to normal.
function buildRulesBox() {
  rulesListEl.innerHTML = "";
  for (const [key, label, min, max, step] of LEVEL_RULES) {
    const wrap = document.createElement("div");
    wrap.className = "ctrl";
    wrap.innerHTML =
      '<div class="row"><span>' + label + '</span>' +
      '<span class="val"></span>' +
      '<button class="btn small ruleReset" title="Back to normal">↺</button></div>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '">';
    const slider = wrap.querySelector("input");
    const valEl = wrap.querySelector(".val");
    const resetBtn = wrap.querySelector(".ruleReset");

    // "Normal" is whatever the game plays at when no level bends it.
    // The editor is never inside a level, so that's simply CONFIG.
    const normal = CONFIG[key];
    const show = () => {
      const changed = ED.rules[key] !== undefined;
      slider.value = changed ? ED.rules[key] : normal;
      valEl.textContent = changed ? ED.rules[key] : "normal";
      valEl.classList.toggle("normal", !changed);
      resetBtn.classList.toggle("hidden", !changed);
    };
    slider.addEventListener("input", () => {
      ED.rules[key] = Number(slider.value);
      show(); updateRulesBtn();
    });
    resetBtn.onclick = () => { delete ED.rules[key]; show(); updateRulesBtn(); };
    show();
    rulesListEl.appendChild(wrap);
  }
}
rulesBtn.onclick = () => { buildRulesBox(); rulesBox.classList.remove("hidden"); };
document.getElementById("rulesDoneBtn").onclick = () => rulesBox.classList.add("hidden");
updateRulesBtn();

function edToText() {
  return ED.grid.map(row => row.join("")).join("\n");
}
function testPlay() {
  startLevel(parseLevel(edToText(), ED.messages), true, false, ED.song, ED.theme, null,
             { reward: ED.reward, rules: ED.rules });
}
document.getElementById("playTestBtn").onclick = testPlay;
// "Try it" in the rules pop-up: shut the pop-up and go and FEEL the change.
document.getElementById("rulesTryBtn").onclick = () => { rulesBox.classList.add("hidden"); testPlay(); };
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
  // ...and so does the level's look, on one line of its own. A level
  // without one doesn't get the line, so old code still looks the same.
  const look = ED.reward ? "  reward: " + JSON.stringify(ED.reward) + ",\n" : "";
  // ...and the numbers this level changes, likewise on one line, and likewise
  // missing altogether from a level that plays by the normal rules.
  const rules = Object.keys(ED.rules).length
    ? "  rules: " + JSON.stringify(ED.rules) + ",\n" : "";
  document.getElementById("exportText").value =
    "{\n  name: \"" + escapeName(levelName()) + "\",\n  song: " + ED.song +
    ",\n  theme: " + ED.theme + ",\n" + signs + look + rules +
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
  // And the level's look. Copy always writes it on ONE line, and a dot never
  // matches a newline — so this grabs that whole line and nothing else, even
  // though the look has a { } inside it.
  const lookMatch = text.match(/reward:\s*(\{.*\})\s*,/);
  let look = null;
  if (lookMatch) { try { look = JSON.parse(lookMatch[1]); } catch (e) { look = null; } }
  // And the numbers it changes. Same one-line trick as the look above.
  const rulesMatch = text.match(/rules:\s*(\{.*\})\s*,/);
  let rules = {};
  if (rulesMatch) { try { rules = JSON.parse(rulesMatch[1]); } catch (e) { rules = {}; } }
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
  ED.reward = (look && look.name && look.skin) ? look : null;
  updateLookBtn();
  ED.rules = (rules && typeof rules === "object" && !Array.isArray(rules)) ? rules : {};
  updateRulesBtn();
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

/* ----------------------------------------------------------------
   A LEVEL WITH TOO MANY COINS. While you draw, the editor keeps you
   inside the limit all by itself — so this only happens to a level
   made BEFORE there was a limit (or one pasted in with Import). Those
   keep working and stay playable; the limit only bites when somebody
   saves them again, and then we ASK first. Nobody's coins ever vanish
   without a "yes".

   Answers true if it's fine to go ahead and save.
   ---------------------------------------------------------------- */
async function trimCoinsIfNeeded() {
  const most = maxCoinsPerLevel();
  const have = countCoins();
  if (have <= most) return true;
  const extra = have - most;
  const ok = await askConfirm("This level has " + have + " coins, and " + most +
    " is the most allowed. Save it with the first " + extra +
    (extra === 1 ? " coin" : " coins") + " taken away?");
  if (!ok) { showToast("Nothing saved."); return false; }
  for (let i = 0; i < extra; i++) removeFirstCoin();
  drawEditor();
  return true;
}

// Actually send the current editor level to the server, then refresh the menu.
async function saveToServer() {
  if (!(await trimCoinsIfNeeded())) return;
  const body = { name: levelName(), author: ED.author, level: edToText(),
                 song: ED.song, theme: ED.theme, messages: ED.messages,
                 reward: ED.reward, rules: ED.rules };
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

// Open a level from the menu for editing: load its grid, name, tune, theme,
// look and rules into the editor and show it.
export function openLevelForEdit(L) {
  const parsed = parseLevel(L.level);
  edLoadGrid(parsed, L.messages);
  ED.editingId = L.id;                              // remember WHICH level we're changing
  ED.author = L.author || "";
  ED.reward = L.reward || null;                     // the cube this level is played as
  ED.rules = { ...(L.rules || {}) };                // and the numbers it changes (a copy, so we edit ours)
  ED.song = (L.song != null) ? (Number(L.song) % SONGS.length) : 0;
  ED.theme = (L.theme != null) ? (Number(L.theme) % THEMES.length) : 0;
  document.getElementById("levelNameInput").value = L.name;
  updateTuneBtn();
  updateThemeBtn();
  updateLookBtn();
  updateRulesBtn();
  S.screen = "editor"; showScreen("editorScreen"); layoutEditor();
}

// Start a brand-new, empty level. If this tablet knows who's playing, that's
// the author already — no need to ask.
export function openNewLevel() {
  ED.editingId = null; ED.author = getPlayerName() || "";
  ED.reward = null;                    // a new level has no look of its own yet
  ED.rules = {};                       // ...and plays by the normal rules
  updateLookBtn();
  updateRulesBtn();
  S.screen = "editor"; showScreen("editorScreen"); layoutEditor();
}

// Come back to the editor after designing this level's look (main.js calls
// this once the cube editor is finished with).
export function backToEditor() {
  S.screen = "editor"; showScreen("editorScreen"); layoutEditor();
}
