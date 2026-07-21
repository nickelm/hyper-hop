// ============================================================
// rules.js — the numbers ONE LEVEL is allowed to change.
// ============================================================
// Normally every level plays by the numbers in config.js. But a level
// may bend a few of them while you are inside it: moon gravity, a
// giant jump, a fiercer rocket. The kids set these with the ⚙ Rules
// button in the level editor, and they are saved with the level.
//
// HOW IT WORKS: the level BORROWS the numbers. When it starts we
// remember what each one was, write the level's number in, and give
// the old ones straight back when you leave. That way nothing else in
// the game has to know about any of this — physics.js and render.js
// just read CONFIG as they always did.
//
// Only movement and feel are in here. Sizes (TILE, PLAYER_SIZE,
// LEVEL_ROWS) are not, because changing those would move the level's
// own tiles about, and colors are not either — the 🎨 theme owns those.

import { CONFIG } from "./config.js";

/* ================================================================
   ============  THE NUMBERS A LEVEL MAY CHANGE  ==================
   ================================================================
   [CONFIG name, label the kids see, smallest, biggest, step]
   Add a line here and a new slider appears in the ⚙ Rules pop-up all
   by itself. Add it to LEVEL_RULE_LIMITS in server/lib/validate.js
   too, or the server will drop it on the way in.
   ================================================================ */
export const LEVEL_RULES = [
  ["GRAVITY",         "Gravity",            1000, 14000,  100],
  ["JUMP_POWER",      "Jump power",          800,  3500,   50],
  ["SCROLL_SPEED",    "Scroll speed",        100,   800,   10],
  ["PAD_POWER",       "Bounce pad power",    600,  2500,   50],
  ["SMALL_PAD_POWER", "Small pad power",     400,  2000,   50],
  ["CATAPULT_POWER",  "Catapult power",      800,  4000,   50],
  ["FLY_THRUST",      "Rocket push",           0, 12000,  100],
  ["FLY_MAX_SPEED",   "Rocket top speed",    100,  1600,   25],
  ["SPIN_SPEED",      "Spin speed",            0,   900,   10],
  ["SPIKE_MERCY",     "Spike mercy",           0,   0.5, 0.05],
  ["RAMP_LAUNCH",     "Ramp pop",              0,     2, 0.05],
  ["FAST_MULT",       "Fast portal",         1.1,     3, 0.05],
  ["SLOW_MULT",       "Slow portal",         0.2,   0.9, 0.05],
  ["CAMERA_X",        "Camera position",     0.1,   0.5, 0.01],
];

// The same list, looked up by name, so we can check a number quickly.
const BY_KEY = new Map(LEVEL_RULES.map(row => [row[0], row]));

// What we borrowed, and what each number was before we did:
// { GRAVITY: 5000 }. Empty means no level is bending anything.
let borrowed = {};

// Is this really one of the numbers a level may change, and is it a
// sensible size? Anything else is ignored, so a hand-edited levels.json
// can never hand the game GRAVITY: 1000000.
function tidy(key, value) {
  const row = BY_KEY.get(key);
  if (!row) return null;                      // not a number a level may change
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const [, , min, max] = row;
  return Math.max(min, Math.min(max, n));
}

/* ----------------------------------------------------------------
   START PLAYING A LEVEL. Give back whatever the last level borrowed,
   then borrow this one's numbers. Giving back FIRST is what stops
   "Play All" piling one level's rules on top of the next one's.
   Call it with nothing at all and the game is simply back to normal.
   ---------------------------------------------------------------- */
export function applyLevelRules(rules) {
  clearLevelRules();
  for (const [key, value] of Object.entries(rules || {})) {
    const number = tidy(key, value);
    if (number === null) continue;
    borrowed[key] = CONFIG[key];              // remember what it was...
    CONFIG[key] = number;                     // ...and play by the level's number
  }
}

// Leaving the level: hand every borrowed number back.
export function clearLevelRules() {
  for (const [key, was] of Object.entries(borrowed)) CONFIG[key] = was;
  borrowed = {};
}

// How many numbers does this level change? (The editor's ⚙ Rules
// button shows the count, so you can see at a glance that a level
// bends the rules without opening it.)
export function countRules(rules) {
  let n = 0;
  for (const [key, value] of Object.entries(rules || {})) {
    if (tidy(key, value) !== null) n++;
  }
  return n;
}
