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
const SCORES_FILE = path.join(DATA_DIR, "scores.json");   // each player's best % per level
const PROFILES_FILE = path.join(DATA_DIR, "profiles.json"); // players + their cube skins
const KEEP_BACKUPS = 200;            // how many old copies of each file to keep

// ---------- Rules for a valid level ----------
const LEVEL_CHARS = new Set([".", "#", "^", "o", "*", "|", "/", "\\", "=", "-", "p", "U", "s", "@", ">", "<"]);
const MAX_COLS = 500;
const MAX_ROWS = 30;

// ---------- Rules for a valid cube skin (looks only, never physics) ----------
// A skin is a little bundle of choices about how a player's cube LOOKS.
// The lists below are the only allowed choices for each part. Anything a
// tablet sends that isn't in these lists is quietly swapped for the default,
// so an old or broken skin can never crash the game.
const SKIN_COLOR = /^#[0-9a-fA-F]{6}$/;                 // a color like "#7dff5e"
const SKIN_SHAPES = new Set(["square", "rounded", "circle", "diamond", "hex"]);
const SKIN_FACES = new Set(["none", "happy", "cool", "angry", "silly", "sleepy", "robot", "emoji"]);
const SKIN_TRAILS = new Set(["off", "fade", "rainbow", "bubbles"]);
const SKIN_EXPLOSIONS = new Set(["squares", "stars", "confetti", "emoji"]);
// The classic green cube the game always had — every missing part falls back here.
const DEFAULT_SKIN = {
  bodyColor: "#7dff5e",
  outlineColor: "#ffffff",
  faceColor: "#05051a",
  shape: "square",
  face: "happy",
  emoji: "😀",
  trail: "fade",
  explosion: "squares",
};
const MAX_NAME = 20;                 // a player name is 1–20 letters

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
      if (!LEVEL_CHARS.has(ch)) throw new Error("That character is not allowed: \"" + ch + "\". Use only . # ^ o * | / \\ = - p U s @ > <");
      if (ch === "|") finishCount++;
    }
  }
  if (finishCount > 1) throw new Error("A level can have at most one finish line (|).");

  // Keep name/author tidy and a sensible length.
  const author = (body.author && typeof body.author === "string") ? body.author.trim() : "";
  const song = Number.isFinite(body.song) ? Math.max(0, Math.floor(body.song)) : 0;
  const theme = Number.isFinite(body.theme) ? Math.max(0, Math.floor(body.theme)) : 0;
  return {
    name: name.slice(0, 40),
    author: (author || "Anonymous").slice(0, 40),
    level,
    song,
    theme,
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

// A high score is one player's best on one level: which level, who, and how
// far they got (0–100%). We check the level really exists so scores can't
// pile up for a level nobody has.
function validateScore(body, levels) {
  const levelId = (body && Number.isFinite(body.levelId)) ? Math.floor(body.levelId) : null;
  if (levelId === null || !levels.some(L => Number(L.id) === levelId)) {
    throw new Error("That level does not exist.");
  }
  const player = (body && typeof body.player === "string") ? body.player.trim() : "";
  if (!player) throw new Error("Please say who is playing.");

  let percent = Number.isFinite(body.percent) ? Math.round(body.percent) : 0;
  percent = Math.max(0, Math.min(100, percent));   // keep it inside 0–100
  return { levelId, player: player.slice(0, 40), percent };
}

// Count how many WHOLE emoji are in a little string. Intl.Segmenter knows that
// things like 👍🏽 or 👨‍👩‍👧 are one emoji even though they are several code points
// glued together; if it isn't around we fall back to counting code points.
function countEmoji(str) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return [...new Intl.Segmenter().segment(str)].length;
  }
  return Array.from(str).length;
}

// Clean up one cube skin. We build a brand-new object with ONLY the parts we
// allow, so any extra fields a tablet sends are dropped (this keeps us safe if
// a newer game adds skin options we don't know about yet). Each part falls back
// to the classic default if it's missing or looks wrong — EXCEPT a color that is
// there but malformed, or an over-long "emoji", which we refuse loudly so a typo
// doesn't silently turn green.
function cleanSkin(raw) {
  const s = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};

  const color = (value, fallback) => {
    if (value == null) return fallback;                 // missing → default
    if (typeof value !== "string" || !SKIN_COLOR.test(value)) {
      throw new Error("A cube color must look like #7dff5e.");
    }
    return value.toLowerCase();
  };
  const choice = (value, allowed, fallback) =>
    (typeof value === "string" && allowed.has(value)) ? value : fallback;

  // The emoji is only used for the "emoji" face/explosion, but we always tidy it.
  // We count whole emoji, so a 50-letter "emoji" is rejected but a fancy one-emoji
  // like 👍🏽, 🇸🇪 or 👨‍👩‍👧 (which are secretly several letters glued together) still counts as ONE.
  let emoji = DEFAULT_SKIN.emoji;
  if (s.emoji != null) {
    if (typeof s.emoji !== "string") throw new Error("That emoji looks wrong.");
    const trimmed = s.emoji.trim();
    if (trimmed) {
      if (trimmed.length > 32 || countEmoji(trimmed) > 1) throw new Error("Please pick just one emoji.");
      emoji = trimmed;
    }
  }

  return {
    bodyColor: color(s.bodyColor, DEFAULT_SKIN.bodyColor),
    outlineColor: color(s.outlineColor, DEFAULT_SKIN.outlineColor),
    faceColor: color(s.faceColor, DEFAULT_SKIN.faceColor),
    shape: choice(s.shape, SKIN_SHAPES, DEFAULT_SKIN.shape),
    face: choice(s.face, SKIN_FACES, DEFAULT_SKIN.face),
    emoji,
    trail: choice(s.trail, SKIN_TRAILS, DEFAULT_SKIN.trail),
    explosion: choice(s.explosion, SKIN_EXPLOSIONS, DEFAULT_SKIN.explosion),
  };
}

// A profile is one player: a name plus the cube skin they made. Returns the
// tidy {name, skin}, or throws an Error with a message we can show the kids.
function validateProfile(body) {
  const name = (body && typeof body.name === "string") ? body.name.trim() : "";
  if (!name) throw new Error("Please give your cube a name.");
  if (Array.from(name).length > MAX_NAME) {
    throw new Error("That name is too long (max " + MAX_NAME + " letters).");
  }
  return { name: name.slice(0, MAX_NAME), skin: cleanSkin(body && body.skin) };
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

// Change the order of the levels. The tablet sends the full list of level ids
// in the new order; we rewrite levels.json to match. (This route must come
// before "/api/levels/:id" below, or ":id" would grab the word "order".)
app.put("/api/levels/order", guard, (req, res) => {
  const order = req.body && req.body.order;
  const levels = readJson(LEVELS_FILE);
  // The new order must list exactly the ids we already have, each one once.
  if (!Array.isArray(order) || order.length !== levels.length) {
    return res.status(400).json({ error: "That new order doesn't match the levels." });
  }
  const byId = new Map(levels.map(L => [Number(L.id), L]));
  const reordered = [];
  for (const id of order) {
    const L = byId.get(Number(id));
    if (!L || reordered.includes(L)) {
      return res.status(400).json({ error: "That new order doesn't match the levels." });
    }
    reordered.push(L);
  }
  writeJsonWithBackup(LEVELS_FILE, reordered);
  res.json(reordered);
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

// ---------- Profiles (players + their cube skins) ----------
// Same pattern as levels: anyone can read, but making or changing a player
// needs the family PIN and is frozen by READ_ONLY. Skins are looks only.
app.get("/api/profiles", (req, res) => {
  res.json(readJson(PROFILES_FILE));
});

app.post("/api/profiles", guard, (req, res) => {
  let clean;
  try { clean = validateProfile(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const profiles = readJson(PROFILES_FILE);
  const nextId = profiles.reduce((m, P) => Math.max(m, Number(P.id) || 0), 0) + 1;
  const profile = { id: nextId, ...clean, updatedAt: new Date().toISOString() };
  profiles.push(profile);
  writeJsonWithBackup(PROFILES_FILE, profiles);
  res.status(201).json(profile);
});

app.put("/api/profiles/:id", guard, (req, res) => {
  let clean;
  try { clean = validateProfile(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = Number(req.params.id);
  const profiles = readJson(PROFILES_FILE);
  const i = profiles.findIndex(P => Number(P.id) === id);
  if (i === -1) return res.status(404).json({ error: "That player does not exist." });

  profiles[i] = { id, ...clean, updatedAt: new Date().toISOString() };
  writeJsonWithBackup(PROFILES_FILE, profiles);
  res.json(profiles[i]);
});

app.delete("/api/profiles/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  const profiles = readJson(PROFILES_FILE);
  const i = profiles.findIndex(P => Number(P.id) === id);
  if (i === -1) return res.status(404).json({ error: "That player does not exist." });

  const [removed] = profiles.splice(i, 1);
  writeJsonWithBackup(PROFILES_FILE, profiles);
  res.json(removed);
});

// ---------- High scores ----------
// Anyone can read the scores.
app.get("/api/scores", (req, res) => {
  res.json(readJson(SCORES_FILE));
});

// Saving a score does NOT need the family PIN — kids play (and beat their best)
// all the time, and asking for the PIN on every run would be no fun. It is still
// frozen by READ_ONLY, so a "look but don't touch" server keeps its scores as-is.
app.post("/api/scores", notFrozen, (req, res) => {
  const levels = readJson(LEVELS_FILE);
  let clean;
  try { clean = validateScore(req.body, levels); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const scores = readJson(SCORES_FILE);
  // One row per (level, player). Only write when this beats their old best.
  const row = scores.find(s => Number(s.levelId) === clean.levelId && s.player === clean.player);
  if (!row) {
    scores.push({ ...clean, updatedAt: new Date().toISOString() });
    writeJsonWithBackup(SCORES_FILE, scores);
  } else if (clean.percent > row.percent) {
    row.percent = clean.percent;
    row.updatedAt = new Date().toISOString();
    writeJsonWithBackup(SCORES_FILE, scores);
  }

  // Send back just this level's leaderboard, best first, so the tablet can
  // update what it shows without re-fetching everything.
  const board = scores
    .filter(s => Number(s.levelId) === clean.levelId)
    .sort((a, b) => b.percent - a.percent);
  res.json(board);
});

app.listen(PORT, () => {
  console.log("Hyper Hop is running →  http://localhost:" + PORT);
  if (READ_ONLY) console.log("READ_ONLY is on: editing is frozen.");
});
