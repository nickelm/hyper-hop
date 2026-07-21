// ============================================================
// storage.js — the little filing cabinet (no database!).
// ============================================================
// All of Hyper Hop's memory is a handful of JSON files in ./data:
// the levels, the shared settings, the high scores, the players and
// their coins. This module is the ONLY place that reads and writes
// them. Before every change it quietly copies the old file into
// data/backups/ and keeps the newest 200, so a bad save can always be
// undone by hand.

"use strict";

const path = require("path");
const fs = require("fs");
const { normalizeLevel } = require("./validate");

// ---------- Where things live on disk ----------
// This file is server/lib/storage.js, so the project root — and its
// data/ folder — is two levels up.
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP_BACKUPS = 200;            // how many old copies of each file to keep

// The price list every new game starts with. A grown-up can edit
// data/prices.json afterwards and the shop notices straight away.
// (Prices live on the SERVER, not in config.js, so nobody can give
// themselves a million coins by editing the game in their browser.)
const DEFAULT_PRICES = {
  startingCoins: 50,        // what every new player starts with
  coinValue: 1,             // how many coins one  *  in a level is worth
  levelCreateBounty: 25,    // a thank-you for making a brand-new level
  maxCoinsPerLevel: 25,     // the most coins one level is allowed to hold
  skin: {                   // what changing each part of your cube costs
    bodyColor: 5, outlineColor: 5, faceColor: 5,
    shape: 20, face: 10, emoji: 15, trail: 25, explosion: 25,
  },
};

/* ----------------------------------------------------------------
   EVERY FILE THE GAME REMEMBERS, in one little list. Add a line here
   and the folder, the first-run setup and the backups all just work.
   `start` says what goes in the file the very first time.
   ---------------------------------------------------------------- */
const FILES = {
  levels:   { name: "levels.json",   start: seedLevels,             note: "starter levels" },
  settings: { name: "settings.json", start: () => ({}),             note: "no shared settings yet" },
  scores:   { name: "scores.json",   start: () => [],               note: "no high scores yet" },
  accounts: { name: "accounts.json", start: () => [],               note: "no players yet" },
  sessions: { name: "sessions.json", start: () => [],               note: "nobody logged in yet" },
  prices:   { name: "prices.json",   start: () => DEFAULT_PRICES,   note: "the shop price list" },
  meta:     { name: "meta.json",     start: () => ({ nextLevelId: 1 }), note: "the game's own notes" },
};
for (const key of Object.keys(FILES)) FILES[key].file = path.join(DATA_DIR, FILES[key].name);

const LEVELS_FILE = FILES.levels.file;
const SETTINGS_FILE = FILES.settings.file;
const SCORES_FILE = FILES.scores.file;
const ACCOUNTS_FILE = FILES.accounts.file;
const SESSIONS_FILE = FILES.sessions.file;
const PRICES_FILE = FILES.prices.file;
const META_FILE = FILES.meta.file;

// The OLD players file. It is not in the list above, so a brand-new
// game never creates it — but the one-time move to accounts.json
// (lib/migrate.js) still needs to know where it used to live.
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json");

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

  // Flying! An  f  gate turns you into a rocket: HOLD the button to climb, let
  // go to drop. Duck under the hanging pillars, hop over the low ones, and note
  // that the  u  gate flips gravity so your rocket pushes the other way for a
  // while. A  c  gate turns you back into a normal jumping cube for the finish.
  // (Aim for about the middle of the screen and you'll get through.)
  { name: "Rocket Run", author: "Built-in", song: 2, level:
`................##..............................#...........................
................##..............................#...........................
................##..............................#...........................
......................................*.....................................
...............................*............................................
............................................................................
..........f.......................u.......n...........c.....................
............................................................................
.....................*.............................................*........
...................................................*........................
............................................................................
......*.....................................................................
..........................##................................................
..........................##....................................^....o....|.` },
];

// The starter levels, ready to save: numbered, tidied and stamped.
function seedLevels() {
  const now = new Date().toISOString();
  return SEED.map((L, i) => ({
    id: i + 1,
    name: L.name,
    author: L.author,
    level: normalizeLevel(L.level),
    song: L.song,
    ownerId: null,          // built-in levels belong to the game itself
    updatedAt: now,
  }));
}

// Make sure the data folders exist, and fill in the files the very
// first time the server ever runs.
function ensureData() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const { file, name, start, note } of Object.values(FILES)) {
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, JSON.stringify(start(), null, 2));
    console.log("Created data/" + name + " (" + note + ").");
  }
  // The level-id counter has to start ABOVE every level already saved,
  // so a brand-new level can never reuse an old level's number.
  const meta = readJson(META_FILE);
  const biggest = readJson(LEVELS_FILE).reduce((m, L) => Math.max(m, Number(L.id) || 0), 0);
  if (!(meta.nextLevelId > biggest)) {
    meta.nextLevelId = biggest + 1;
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
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
// We write to a scratch file first and then swap it into place in one
// step, so if the power goes out mid-save the old file is still whole.
function writeJsonWithBackup(file, data) {
  backupFile(file);
  const scratch = file + ".tmp";
  fs.writeFileSync(scratch, JSON.stringify(data, null, 2));
  fs.renameSync(scratch, file);      // one instant swap — never a half-written file
}

/* ----------------------------------------------------------------
   CHANGING A FILE SAFELY.

   Say two tablets finish a level at the very same moment. If both
   read the coins, both add some, and both save, one kid's coins get
   wiped out. So all changes go through updateJson: it reads, changes
   and saves in ONE go, with nothing allowed to squeeze in between.

   IMPORTANT: the `change` function must be a plain function — never
   use `await` inside it! Node does one thing at a time, and reading
   and writing files this way never pauses, so nothing can interrupt
   us. One `await` in the middle would open that gap right back up.

   Return SKIP_SAVE from `change` to say "nothing actually changed,
   don't save" — that keeps the backups folder from filling up with
   200 identical copies.
   ---------------------------------------------------------------- */
const SKIP_SAVE = Symbol("skip save");

function updateJson(file, change) {
  const data = readJson(file);
  const result = change(data);       // if this throws, we save nothing at all
  if (result === SKIP_SAVE) return result;
  writeJsonWithBackup(file, data);
  return result;
}

// A level number that is NEVER used twice, even after a level is
// deleted. (If numbers came back around, a brand-new level could look
// like one you already got paid a bounty for.)
function nextLevelId() {
  return updateJson(META_FILE, meta => {
    const id = meta.nextLevelId || 1;
    meta.nextLevelId = id + 1;
    return id;
  });
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
  ACCOUNTS_FILE, SESSIONS_FILE, PRICES_FILE, META_FILE, DEFAULT_PRICES,
  ensureData, readJson, safeTimestamp, backupFile, writeJsonWithBackup,
  updateJson, SKIP_SAVE, nextLevelId, nextId, indexById,
};
