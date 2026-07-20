// ============================================================
// storage.js — the little filing cabinet (no database!).
// ============================================================
// All of Hyper Hop's memory is a handful of JSON files in ./data:
// the levels, the shared settings, the high scores, and the players.
// This module is the ONLY place that reads and writes them. Before
// every change it quietly copies the old file into data/backups/ and
// keeps the newest 200, so a bad save can always be undone by hand.

"use strict";

const path = require("path");
const fs = require("fs");
const { normalizeLevel } = require("./validate");

// ---------- Where things live on disk ----------
// This file is server/lib/storage.js, so the project root — and its
// data/ folder — is two levels up.
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const LEVELS_FILE = path.join(DATA_DIR, "levels.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const SCORES_FILE = path.join(DATA_DIR, "scores.json");   // each player's best % per level
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json"); // players + their cube skins
const KEEP_BACKUPS = 200;            // how many old copies of each file to keep

/* ================================================================
   The starter levels. On a brand-new server (empty ./data) these
   get written into levels.json so there is always something to play.
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
  // A ramp showcase: run UP a  /  onto a block platform, glide DOWN a  \\ ,
  // then crest a lone  /  for a little launch pop before the finish.
  // (Down-ramps are written  \\  here because this is a `template literal`,
  // where a single backslash would be swallowed as an escape.)
  { name: "Ramp Ramble", author: "Built-in", song: 2, level:
`........................................................
........................................................
........................................................
........................................................
............*...............*...........................
........../####\\............/..............|............` },
  // A gadget showcase: hop the saws, bounce the small pink pad, run up the ramp
  // and across the = platforms + - bridge, then a @ checkpoint before the last saws.
  { name: "Gizmo Playground", author: "Built-in", song: 0, level:
`.....................................................
..............*.............*...............*........
...........======...............========.............
.....................................................
.....................................................
..........s.....p......./#===-.......@.....s......|..` },
  // A portal showcase: a  u  gate flips gravity (you land on the ceiling!), an  n
  // gate drops you back down, then  >  speeds the world up and  <  slows it again.
  { name: "Portal Playground", author: "Built-in", song: 1, level:
`..................*...................*..............
.....................................................
.....................................................
............u...........n............................
..........*.................*.......>.......<........
.....................................................
..............................................|......` },
];

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
  if (!fs.existsSync(SCORES_FILE)) {
    fs.writeFileSync(SCORES_FILE, JSON.stringify([], null, 2));
    console.log("Created data/scores.json (no high scores yet).");
  }
  if (!fs.existsSync(PROFILES_FILE)) {
    fs.writeFileSync(PROFILES_FILE, JSON.stringify([], null, 2));
    console.log("Created data/profiles.json (no players yet).");
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

// ---------- Little helpers for our lists of {id, ...} rows ----------
// The next free id: one more than the biggest id we already have.
function nextId(rows) {
  return rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1;
}
// Where in the list is the row with this id? (-1 if there isn't one.)
function indexById(rows, id) {
  return rows.findIndex(r => Number(r.id) === Number(id));
}

module.exports = {
  DATA_DIR, BACKUP_DIR, LEVELS_FILE, SETTINGS_FILE, SCORES_FILE, PROFILES_FILE,
  ensureData, readJson, safeTimestamp, backupFile, writeJsonWithBackup,
  nextId, indexById,
};
