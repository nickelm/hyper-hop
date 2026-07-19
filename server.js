/* ================================================================
   server.js — Hyper Hop's tiny family server
   ================================================================
   A small Node + Express app. It does three jobs:

     1. Serves the game (the files in ./public) to any tablet.
     2. Keeps everyone's levels and shared settings in flat JSON
        files in ./data  (no database — just files!).
     3. Guards every change with a family PIN, and quietly backs up
        each file before it changes so nothing is ever lost.

   Run it like this:
       npm install
       FAMILY_PIN=1234 node server.js
   Then open http://localhost:3000

   Settings you can pass in the environment:
       PORT        which port to listen on   (default 3000)
       FAMILY_PIN  the secret the kids type to save (default "1234" for
                   local testing — ALWAYS set a real one in production)
       READ_ONLY   "true" freezes all editing (a friendly "no" to writes)
   ================================================================ */

"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

// ---------- Settings that come from the environment ----------
const PORT = process.env.PORT || 3000;
const READ_ONLY = process.env.READ_ONLY === "true";
let FAMILY_PIN = process.env.FAMILY_PIN;
if (!FAMILY_PIN) {
  FAMILY_PIN = "1234";
  console.warn(
    "\n  ⚠  FAMILY_PIN is not set — using the test PIN \"1234\".\n" +
    "     Set a real one before deploying:  FAMILY_PIN=your-secret node server.js\n"
  );
}

// ---------- Where things live on disk ----------
const DATA_DIR = path.join(__dirname, "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const LEVELS_FILE = path.join(DATA_DIR, "levels.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const KEEP_BACKUPS = 200;            // how many old copies of each file to keep

// ---------- Rules for a valid level ----------
const LEVEL_CHARS = new Set([".", "#", "^", "o", "*", "|"]);
const MAX_COLS = 500;
const MAX_ROWS = 30;

// The full list of CONFIG names the settings file is allowed to override.
// (This must stay in sync with the CONFIG block in public/index.html.)
const KNOWN_SETTING_KEYS = new Set([
  "SCROLL_SPEED", "GRAVITY", "JUMP_POWER", "PAD_POWER", "SPIN_SPEED",
  "TILE", "PLAYER_SIZE", "SPIKE_MERCY",
  "PLAYER_COLOR", "PLAYER_EYE_COLOR", "BLOCK_COLOR", "BLOCK_EDGE",
  "SPIKE_COLOR", "PAD_COLOR", "COIN_COLOR", "GROUND_COLOR",
  "SKY_TOP", "SKY_BOTTOM",
  "PARTICLES_ON_DEATH", "TRAIL", "SCREEN_SHAKE",
  "SOUND", "MUSIC", "MUSIC_VOLUME", "MUSIC_BPM", "BEAT_PULSE",
]);

/* ================================================================
   The starter levels. On a brand-new server (empty ./data) these
   get written into levels.json so there is always something to play.
   They are the four levels the game shipped with.
   ================================================================ */
const SEED = [
  { name: "First Steps", author: "Built-in", song: 0, level:
`......................................................................
......................................................................
................................*.....................................
.......................................###...............*............
...................^.......^....###...###....o......^^...##..........|` },
  { name: "Spike Alley", author: "Built-in", song: 1, level:
`..........................................................................
.......................*.....................*............................
...................................o................####..................
......................###.......^..........####.....####.....*............
................^^....###...^^..^....^^^...####..^^..####...###..^^^.....|` },
  { name: "Bounce House", author: "Built-in", song: 2, level:
`..............................................................................
.......................*..................*...................*...............
......................####..............####................####..............
......................####....*.........####................####..............
..............o.......####....o..........####......o........####......o......|` },
  { name: "Getting Better", author: "Built-in", song: 3, level:
`..................................................
..................................................
..................................................
..................................................
...............^........................#.........
.............###^...^^....#^^#^^#.....^...^....|..` },
];

/* ================================================================
   Reading and writing the little JSON files, with backups.
   ================================================================ */

// Make sure the data folders exist, and fill in the files the very
// first time the server ever runs.
function ensureData() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (!fs.existsSync(LEVELS_FILE)) {
    const now = new Date().toISOString();
    const seeded = SEED.map((L, i) => ({
      id: i + 1,
      name: L.name,
      author: L.author,
      level: normalizeLevel(L.level),
      song: L.song,
      updatedAt: now,
    }));
    fs.writeFileSync(LEVELS_FILE, JSON.stringify(seeded, null, 2));
    console.log("Seeded data/levels.json with " + seeded.length + " starter levels.");
  }
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({}, null, 2));
    console.log("Created data/settings.json (no overrides yet).");
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// A timestamp that is safe to use in a filename on EVERY computer.
// A normal ISO time has colons (2026-07-19T15:30:00.123Z) and Windows
// will not allow colons in filenames — so we swap them for dashes.
function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

// Copy a file to the backups folder before we change it, then throw
// away the oldest backups so the folder never grows without limit.
function backupFile(file) {
  if (!fs.existsSync(file)) return;
  const base = path.basename(file);                       // e.g. "levels.json"
  const backupName = base + "." + safeTimestamp() + ".json";
  fs.copyFileSync(file, path.join(BACKUP_DIR, backupName));

  // Keep only the newest KEEP_BACKUPS copies of THIS file.
  const prefix = base + ".";
  const old = fs.readdirSync(BACKUP_DIR)
    .filter(n => n.startsWith(prefix))
    .sort();                                               // timestamps sort in time order
  while (old.length > KEEP_BACKUPS) {
    fs.unlinkSync(path.join(BACKUP_DIR, old.shift()));
  }
}

// Back up the current file, then save the new data over it.
function writeJsonWithBackup(file, data) {
  backupFile(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/* ================================================================
   Checking that a level is drawn with legal tiles and is not silly-huge.
   Returns the cleaned-up level text, or throws an Error with a message
   we are happy to show the kids.
   ================================================================ */

// Trim blank lines off the top and bottom (the level format often has a
// leading newline) and drop trailing spaces so rows line up.
function normalizeLevel(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

function validateLevel(body) {
  const name = (body && typeof body.name === "string") ? body.name.trim() : "";
  if (!name) throw new Error("Please give the level a name.");

  if (!body || typeof body.level !== "string") throw new Error("The level is missing its grid.");
  const level = normalizeLevel(body.level);
  const rows = level.split("\n");
  if (rows.length === 0 || rows.every(r => r === "")) throw new Error("The level is empty.");

  if (rows.length > MAX_ROWS) throw new Error("Too many rows (max " + MAX_ROWS + ").");

  const width = rows[0].length;
  if (width > MAX_COLS) throw new Error("Too wide (max " + MAX_COLS + " columns).");

  let finishCount = 0;
  for (const row of rows) {
    if (row.length !== width) throw new Error("All rows must be the same length.");
    for (const ch of row) {
      if (!LEVEL_CHARS.has(ch)) throw new Error("That character is not allowed: \"" + ch + "\". Use only . # ^ o * |");
      if (ch === "|") finishCount++;
    }
  }
  if (finishCount > 1) throw new Error("A level can have at most one finish line (|).");

  // Keep name/author tidy and a sensible length.
  const author = (body.author && typeof body.author === "string") ? body.author.trim() : "";
  const song = Number.isFinite(body.song) ? Math.max(0, Math.floor(body.song)) : 0;
  return {
    name: name.slice(0, 40),
    author: (author || "Anonymous").slice(0, 40),
    level,
    song,
  };
}

// Settings overrides must be a flat object of known CONFIG names with
// simple values (number / string / true / false).
function validateSettings(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Settings must be an object.");
  }
  const clean = {};
  for (const [key, value] of Object.entries(body)) {
    if (!KNOWN_SETTING_KEYS.has(key)) throw new Error("Unknown setting: " + key);
    const t = typeof value;
    if (t !== "number" && t !== "string" && t !== "boolean") {
      throw new Error("Setting " + key + " has a strange value.");
    }
    clean[key] = value;
  }
  return clean;
}

/* ================================================================
   The web server itself.
   ================================================================ */
ensureData();

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Guards that run before any change ----------

// Freeze switch: when READ_ONLY is on, politely refuse every change.
function notFrozen(req, res, next) {
  if (READ_ONLY) {
    return res.status(403).json({ error: "Editing is frozen right now. 🧊" });
  }
  next();
}

// The family PIN: the tablet must send the right secret to save anything.
function requirePin(req, res, next) {
  const pin = req.get("X-Family-Pin");
  if (pin !== FAMILY_PIN) {
    return res.status(401).json({ error: "Wrong family PIN — ask a grown-up!" });
  }
  next();
}

// Every mutating route uses both guards, in this order.
const guard = [notFrozen, requirePin];

// ---------- Levels ----------
app.get("/api/levels", (req, res) => {
  res.json(readJson(LEVELS_FILE));
});

app.post("/api/levels", guard, (req, res) => {
  let clean;
  try { clean = validateLevel(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const levels = readJson(LEVELS_FILE);
  const nextId = levels.reduce((m, L) => Math.max(m, Number(L.id) || 0), 0) + 1;
  const level = { id: nextId, ...clean, updatedAt: new Date().toISOString() };
  levels.push(level);
  writeJsonWithBackup(LEVELS_FILE, levels);
  res.status(201).json(level);
});

app.put("/api/levels/:id", guard, (req, res) => {
  let clean;
  try { clean = validateLevel(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = Number(req.params.id);
  const levels = readJson(LEVELS_FILE);
  const i = levels.findIndex(L => Number(L.id) === id);
  if (i === -1) return res.status(404).json({ error: "That level does not exist." });

  levels[i] = { id, ...clean, updatedAt: new Date().toISOString() };
  writeJsonWithBackup(LEVELS_FILE, levels);
  res.json(levels[i]);
});

app.delete("/api/levels/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  const levels = readJson(LEVELS_FILE);
  const i = levels.findIndex(L => Number(L.id) === id);
  if (i === -1) return res.status(404).json({ error: "That level does not exist." });

  const [removed] = levels.splice(i, 1);
  writeJsonWithBackup(LEVELS_FILE, levels);
  res.json(removed);
});

// ---------- Settings ----------
app.get("/api/settings", (req, res) => {
  res.json(readJson(SETTINGS_FILE));
});

app.put("/api/settings", guard, (req, res) => {
  let clean;
  try { clean = validateSettings(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  writeJsonWithBackup(SETTINGS_FILE, clean);
  res.json(clean);
});

app.listen(PORT, () => {
  console.log("Hyper Hop is running →  http://localhost:" + PORT);
  if (READ_ONLY) console.log("READ_ONLY is on: editing is frozen.");
});
