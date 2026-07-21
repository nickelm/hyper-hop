// ============================================================
// validate.js — the bouncer for everything a tablet sends up.
// ============================================================
// Every level, settings change, high score, and cube skin that
// comes from a tablet is checked here before we save it. If it
// looks wrong we throw an Error with a kid-friendly message the
// server can show. The list of allowed level tiles lives here,
// once, so it can never drift out of sync with itself.

"use strict";

// ---------- Rules for a valid level ----------
// The ONE list of tiles a level is allowed to use. Everything that
// checks or describes level tiles reads from this, so there is a
// single source of truth.
const LEVEL_CHARS = new Set([".", "#", "^", "o", "*", "|", "/", "\\", "L", "7", "=", "-", "p", "U", "s", "@", "!", ">", "<", "u", "n", "f", "c", "h", "g"]);
const LEVEL_CHARS_HELP = [...LEVEL_CHARS].join(" ");   // "‎. # ^ o * | / \ = - ..." for error messages
const MAX_COLS = 500;
const MAX_ROWS = 30;
// A level's signs: what each  !  square says. The words are kept BESIDE the
// grid (see cleanMessages), so the grid stays a plain rectangle of letters.
const MAX_MESSAGES = 30;
const MAX_MESSAGE = 120;

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
  "SCROLL_SPEED", "GRAVITY", "JUMP_POWER", "PAD_POWER", "SPIN_SPEED", "CAMERA_X",
  "SMALL_PAD_POWER", "CATAPULT_POWER",
  "RAMP_LAUNCH", "RAMP_GLUE", "BRIDGE_FADE_TIME",
  "FAST_MULT", "SLOW_MULT",
  "FLY_THRUST", "FLY_MAX_SPEED", "FLY_TILT",
  "LEVEL_ROWS", "TILE", "PLAYER_SIZE", "SPIKE_MERCY", "SAW_RADIUS",
  "PLAYER_COLOR", "PLAYER_EYE_COLOR", "BLOCK_COLOR", "BLOCK_EDGE",
  "SPIKE_COLOR", "PAD_COLOR", "SMALL_PAD_COLOR", "CATAPULT_COLOR",
  "COIN_COLOR", "COIN_SILVER_COLOR", "GROUND_COLOR",
  "SIGN_COLOR", "SIGN_TEXT_COLOR", "SIGN_TEXT_SIZE",
  "SKY_TOP", "SKY_BOTTOM",
  "PARTICLES_ON_DEATH", "TRAIL", "SCREEN_SHAKE",
  "SOUND", "MUSIC", "MUSIC_VOLUME", "MUSIC_BPM", "BEAT_PULSE",
]);

// Trim blank lines off the top and bottom (the level format often has a
// leading newline) and drop trailing spaces so rows line up.
function normalizeLevel(text) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

/* ----------------------------------------------------------------
   WHERE ARE THE COINS? Answers with a set of keys like "12,4"
   (column, row) — EXACTLY the same names the game's physics uses, so
   the server and the tablet always mean the same coin.

   The server needs this to check a tablet's "I collected these coins!"
   message. Without it, a kid could send made-up coins and get paid.

   CAREFUL: this has to tidy the rows the SAME way parseLevel does in
   public/js/game/level.js — blank rows are dropped and short rows are
   padded. If we counted rows differently, every row number would be
   off and no coin would ever pay out.
   ---------------------------------------------------------------- */
function coinKeysFor(levelText) {
  const rows = String(levelText).split("\n")
    .map(r => r.replace(/\r/g, ""))
    .filter(r => r.trim().length > 0);          // same as parseLevel: blank rows vanish
  const keys = new Set();
  if (!rows.length) return keys;
  const width = Math.max(...rows.map(r => r.length));
  rows.forEach((row, rowNumber) => {
    const padded = row.padEnd(width, ".");
    for (let col = 0; col < width; col++) {
      if (padded[col] === "*") keys.add(col + "," + rowNumber);
    }
  });
  return keys;
}

/* ----------------------------------------------------------------
   THE SIGNS a level carries: { "12,9": "HOLD to fly up!" } — which
   square the signpost is on, and what it says.

   Anything strange (a number instead of words, a key that isn't a
   square, a sign hanging off the edge of the level) is quietly
   DROPPED rather than refused, the same way an unknown skin field is:
   an odd sign should never stop a kid saving their level. Only the
   two limits below are hard, and they're generous.
   ---------------------------------------------------------------- */
function cleanMessages(raw, cols, rows) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let kept = 0;
  for (const [key, text] of Object.entries(raw)) {
    if (kept >= MAX_MESSAGES) break;
    if (!/^\d+,\d+$/.test(key)) continue;
    const [col, row] = key.split(",").map(Number);
    if (col >= cols || row >= rows) continue;        // not a square in this level
    if (typeof text !== "string") continue;
    const words = text.trim().slice(0, MAX_MESSAGE);
    if (!words) continue;
    out[key] = words;
    kept++;
  }
  return out;
}

/* ----------------------------------------------------------------
   THE LOOK A LEVEL CARRIES: { name: "The Crow", skin: {...} } — the
   cube everybody wears while playing it, and the prize you keep once
   you finish it. Most levels haven't got one, and that's why this
   answers null rather than making something up.

   Anything odd is DROPPED, not refused (the same rule as the signs
   above): a strange look should never stop a kid saving their level.
   ---------------------------------------------------------------- */
function cleanReward(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  try {
    return { name: validateName(raw.name), skin: cleanSkin(raw.skin) };
  } catch (e) {
    return null;              // no name, or a broken cube — just no look, then
  }
}

// Check that a level is drawn with legal tiles and is not silly-huge.
// Returns the cleaned-up {name, author, level, song, theme}, or throws
// an Error with a message we are happy to show the kids.
//
// `limits.maxCoins` is the most  *  this level may hold. It's handed IN
// rather than looked up here, because the number lives in the price list
// (data/prices.json) and lib/prices.js already asks storage.js, which asks
// us — so fetching it here would go round in a circle. Leave it out and
// there is no coin limit at all, exactly as before.
function validateLevel(body, limits = {}) {
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
      if (!LEVEL_CHARS.has(ch)) throw new Error("That character is not allowed: \"" + ch + "\". Use only " + LEVEL_CHARS_HELP);
      if (ch === "|") finishCount++;
    }
  }
  if (finishCount > 1) throw new Error("A level can have at most one finish line (|).");

  // Not too many coins. We count them with coinKeysFor — the same function that
  // decides which coins pay out — so "how many coins are in this level" can only
  // ever mean one thing. (The editor trims coins before it saves, so a kid
  // should never see this; the server checks anyway, because a tablet can send
  // us anything it likes.)
  if (Number.isFinite(limits.maxCoins)) {
    const coins = coinKeysFor(level).size;
    if (coins > limits.maxCoins) {
      throw new Error("Too many coins (" + coins + ") — a level can have at most " +
                      limits.maxCoins + ". Take some out. 🙂");
    }
  }

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
    messages: cleanMessages(body.messages, width, rows.length),
    // The look this level makes you wear (and gives you for finishing it).
    // Always answered — null when there isn't one — so saving a level that
    // USED to have a look really does take it away again.
    reward: cleanReward(body.reward),
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

// Check a player's name on its own (used when signing up and when
// renaming). Returns the tidy name, or throws a friendly Error.
function validateName(raw) {
  const name = (typeof raw === "string") ? raw.trim() : "";
  if (!name) throw new Error("Please type a name.");
  if (Array.from(name).length > MAX_NAME) {
    throw new Error("That name is too long (max " + MAX_NAME + " letters).");
  }
  return name.slice(0, MAX_NAME);
}

/* ----------------------------------------------------------------
   WHAT A PLAYER MAY CHANGE ABOUT THEMSELVES: their name and their
   cube. That's it.

   This hands back a little "patch" — ONLY the things that were
   actually sent — and the route then merges it onto the saved player.
   That matters a lot: the old code rebuilt the whole player from
   scratch, so anything not listed here (your coins! your password!)
   would have been wiped out every time you saved your cube.

   It's also an allow-list, so even if a tablet cheekily sends
   {coins: 999999, role: "admin"} those simply never make it in.
   ---------------------------------------------------------------- */
function validateAccountEdit(body) {
  const b = (body && typeof body === "object" && !Array.isArray(body)) ? body : {};
  const patch = {};
  if (b.name != null) patch.name = validateName(b.name);
  if (b.skin != null) patch.skin = cleanSkin(b.skin);
  return patch;
}

module.exports = {
  LEVEL_CHARS, MAX_COLS, MAX_ROWS, DEFAULT_SKIN, MAX_NAME, KNOWN_SETTING_KEYS,
  normalizeLevel, validateLevel, validateSettings, validateScore,
  countEmoji, cleanSkin, cleanMessages, cleanReward, coinKeysFor, validateName, validateAccountEdit,
};
