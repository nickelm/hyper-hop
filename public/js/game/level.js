// ============================================================
// level.js — the level format: how text turns into a playable map.
// ============================================================
// A level is just a grid of letters, one per square. This module
// turns that text into a {grid, cols, rows} map and answers two
// questions the rest of the game asks a lot: "what tile is at this
// square?" and "how high is this row?". It's pure — no drawing,
// no sound — so the physics can lean on it and stay pure too.

import { CONFIG } from "../config.js";

/* ----------------------------------------------------------------
   THE TILE LEGEND — one letter per square (see CLAUDE.md for the
   full story). This is the kids' main way to build levels, so it
   must never change lightly.

     .  empty air
     #  solid block (stand on top; hitting the side = death)
     /  up-ramp     \  down-ramp     (sloped ground, never deadly)
     ^  spike        s  saw blade    (both deadly)
     o  bounce pad   p  small pad     U  catapult   (launch you up)
     *  coin          @  checkpoint   |  finish line
     =  jump-through platform   -  disappearing bridge
     >  speed up      <  slow down    (speed gates)
     u  flip gravity  n  gravity back (gravity gates)
     f  fly (rocket)  c  cube again   (flight gates)
     h  hole (ground off)  g  ground back on   (ground gates)

   The floor is implicit: the bottom row sits on an automatic ground
   plane. All rows in a level must be the same length. The SKY, though,
   is always CONFIG.LEVEL_ROWS tall no matter how few rows a level has
   (see skyTop below) — that's the room you need to fly.
   ---------------------------------------------------------------- */

// Turn a level's text into a map: a grid of rows, plus how many
// columns and rows it has. Blank lines are dropped and short rows
// are padded with empty air so every row is the same width.
export function parseLevel(text) {
  const rows = text.split("\n").map(r => r.replace(/\r/g, "")).filter(r => r.trim().length > 0);
  const width = Math.max(...rows.map(r => r.length));
  const grid = rows.map(r => r.padEnd(width, "."));
  return { grid, cols: width, rows: grid.length };
}

// What tile is at this square? Anything off the edge of the map counts
// as empty air ("."), so the physics never has to check the borders.
export function tileAt(level, col, row) {
  if (col < 0 || col >= level.cols || row < 0 || row >= level.rows) return ".";
  return level.grid[row][col];
}

// The world y of the TOP of a given grid row. Floor is at y = 0 and up is
// negative y, so higher rows (smaller row numbers) sit further up (more
// negative). The bottom row (rows-1) sits right on the floor.
export function cellTop(level, row) {
  return -(level.rows - row) * CONFIG.TILE;
}

// The roof of the world — how high the sky goes above the floor. Every level
// gets a tall sky (CONFIG.LEVEL_ROWS squares), even a short one, because that's
// the room you need to fly. A level with MORE rows than that keeps its own top.
// You only ever bump into this roof with gravity flipped, or while flying.
export function skyTop(level) {
  return -Math.max(level.rows, CONFIG.LEVEL_ROWS) * CONFIG.TILE;
}

/* ----------------------------------------------------------------
   WHERE IS THE GROUND SWITCHED ON? An  h  gate opens a hole (no
   ground at all from there on) and a  g  gate builds it back. The
   physics works this out as you run past the gates; the DRAWING
   needs to know it for every column at once, so it can leave the
   ground out where the hole is. Same rule either way: whichever
   gate you passed most recently wins, and a level starts with the
   ground on.

   Worked out once per level and remembered, because draw() asks for
   it on every single frame.
   ---------------------------------------------------------------- */
export function groundSpans(level) {
  if (level.groundOnByColumn) return level.groundOnByColumn;
  const on = new Array(level.cols);
  let isOn = true;
  for (let col = 0; col < level.cols; col++) {
    for (let row = 0; row < level.rows; row++) {
      const ch = level.grid[row][col];
      if (ch === "h") { isOn = false; break; }
      if (ch === "g") { isOn = true; break; }
    }
    on[col] = isOn;
  }
  level.groundOnByColumn = on;
  return on;
}
