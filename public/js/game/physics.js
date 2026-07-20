// ============================================================
// physics.js — the rules of the world (and nothing else).
// ============================================================
// This is where the cube actually moves: gravity, jumping, landing
// on blocks and ramps, dying on spikes, bouncing off pads, portals,
// coins, and the finish line. It is PURE — no drawing, no sound, no
// talking to the server. You hand it a `state` object and a time
// step, and it changes the state. Anything that needs a sound or a
// splash of particles is left as a note in state.events for the game
// loop to act on, so the physics stays the same on every device.
//
// The `state` it works on looks like:
//   { player, camX, speedMult, gravityDir, level, coinsGot, trail,
//     bridgeFades, tileCheckpoint, activatedCheckpoints, events }

import { CONFIG } from "../config.js";
import { tileAt, cellTop, skyTop } from "./level.js";

// The physics runs at a fixed 240 steps a second, no matter how fast
// the screen draws, so the game feels exactly the same on every tablet.
export const FIXED_DT = 1 / 240;

// Move the world forward by one tiny step `dt`.
export function stepPhysics(state, dt) {
  const player = state.player;
  if (player.dead || player.won) return;
  const T = CONFIG.TILE, half = CONFIG.PLAYER_SIZE / 2;

  const prevX = player.x;                    // remember where we were, for portal crossings
  player.x += CONFIG.SCROLL_SPEED * state.speedMult * dt;
  state.camX += CONFIG.SCROLL_SPEED * state.speedMult * dt;
  player.vy += CONFIG.GRAVITY * state.gravityDir * dt;   // gravityDir flips which way "down" pulls
  player.y += player.vy * dt;

  // ---- portals: gates that fill a whole column and fire when the cube's CENTER
  // crosses the column's middle (so they work at any height). A  >  speeds the
  // world up, a  <  slows it down — absolute, not stacking (the newest one wins).
  {
    const colA = Math.floor(prevX / T) - 1, colB = Math.floor(player.x / T) + 1;
    for (let c = colA; c <= colB; c++) {
      const mid = c * T + T / 2;
      if (prevX < mid && player.x >= mid) {   // just crossed this column's midline
        const p = portalInColumn(state, c);
        if (p === ">") state.speedMult = CONFIG.FAST_MULT;
        else if (p === "<") state.speedMult = CONFIG.SLOW_MULT;
        const g = gravityPortalInColumn(state, c);   // u = flip gravity, n = back to normal (absolute)
        if (g === "u") state.gravityDir = -1;
        else if (g === "n") state.gravityDir = 1;
      }
    }
  }

  // spin in the air, snap when landed
  if (!player.onGround) player.rot += CONFIG.SPIN_SPEED * dt;

  player.onGround = false;

  // The ground you land on depends on gravity: normally the implicit floor at
  // the bottom (y = 0); flipped, the implicit ceiling at the top of the grid.
  if (state.gravityDir > 0) {
    if (player.y + half >= 0) {
      player.y = -half; player.vy = 0; player.onGround = true;
      player.rot = Math.round(player.rot / 90) * 90;
    }
  } else {
    const yCeil = skyTop(state.level);                // the roof of the world, mirroring the floor
    if (player.y - half <= yCeil) {
      player.y = yCeil + half; player.vy = 0; player.onGround = true;
      player.rot = Math.round(player.rot / 90) * 90;
    }
  }

  // columns near the player (used by both the ramp pass and the tile pass)
  const c0 = Math.floor((player.x - half) / T) - 1, c1 = Math.floor((player.x + half) / T) + 1;

  // ---- ramps: sloped ground that only ever pushes you UP, never kills ----
  // We do this BEFORE the block/spike pass so a ramp lifts the cube onto a
  // block stack instead of the block's side killing it.
  const wasOnRampUp = player.onRamp === 1;   // remember, so we can launch off the top of a /
  player.onRamp = 0;
  const jumping = player.vy < 0;             // going up (a jump or pad) always beats the ramp glue
  // Ramps are ignored while gravity is flipped (they simply do nothing, and still
  // never kill) — see the note in CLAUDE.md.
  for (let col = c0; state.gravityDir > 0 && col <= c1; col++) {
    for (let row = 0; row < state.level.rows; row++) {
      const ch = tileAt(state.level, col, row);
      if (ch !== "/" && ch !== "\\") continue;
      const tx = col * T, ty = cellTop(state.level, row);
      // only care when the cube's CENTER is over this ramp column (kind on purpose)
      if (player.x < tx || player.x >= tx + T) continue;
      const f = (player.x - tx) / T;                          // 0 at left edge, 1 at right edge
      // where the top of the slope is at this x. / rises to the right, \ drops to the right.
      const surfaceY = ch === "/" ? ty + T - f * T : ty + f * T;
      const bottom = player.y + half;
      // stick to the slope: cube sitting on it, sunk below it, or within RAMP_GLUE above it
      if (!jumping && bottom >= surfaceY - CONFIG.RAMP_GLUE) {
        player.y = surfaceY - half;
        if (player.vy > 0) player.vy = 0;
        player.onGround = true;
        player.onRamp = ch === "/" ? 1 : -1;
        player.rot = player.onRamp === 1 ? -45 : 45;          // tilt the cube to match the slope
      }
    }
  }

  // tiles near the player
  for (let col = c0; col <= c1; col++) {
    for (let row = 0; row < state.level.rows; row++) {
      const ch = tileAt(state.level, col, row);
      if (ch === ".") continue;
      const tx = col * T, ty = cellTop(state.level, row);       // tile top-left
      const overlapX = player.x + half > tx && player.x - half < tx + T;
      const overlapY = player.y + half > ty && player.y - half < ty + T;

      if (ch === "#") {
        if (!overlapX || !overlapY) continue;
        if (state.gravityDir > 0) {
          // normal: land on the TOP if we were above it last step and falling down
          const prevBottom = player.y + half - player.vy * dt;
          if (player.vy >= 0 && prevBottom <= ty + 6) {
            player.y = ty - half; player.vy = 0; player.onGround = true;
            player.rot = Math.round(player.rot / 90) * 90;
          } else if (!player.onRamp) {
            die(state);                                 // hit the side or bottom
          }
        } else {
          // flipped: land on the UNDERSIDE if we were below it last step and falling up
          const prevTop = player.y - half - player.vy * dt;
          if (player.vy <= 0 && prevTop >= ty + T - 6) {
            player.y = ty + T + half; player.vy = 0; player.onGround = true;
            player.rot = Math.round(player.rot / 90) * 90;
          } else if (!player.onRamp) {
            die(state);                                 // hit the side or top
          }
        }
        // If a ramp is holding us up (onRamp), a block beside us must NOT kill:
        // the ramp is carrying us up the side of the stack onto its top.
      } else if (ch === "^") {
        // forgiving spike hitbox: a smaller box in the middle
        const m = T * CONFIG.SPIKE_MERCY;
        const hx = tx + m, hw = T - 2 * m, hy = ty + m, hh = T - m;
        if (player.x + half > hx && player.x - half < hx + hw &&
            player.y + half > hy && player.y - half < hy + hh) die(state);
      } else if (ch === "s") {
        // saw blade: a round deadly circle in the middle of the tile.
        // Find the point on the cube's box closest to the circle's center;
        // if that point is inside the circle, the saw got us.
        const cx = tx + T / 2, cy = ty + T / 2, rad = CONFIG.SAW_RADIUS * T;
        const nearestX = Math.max(player.x - half, Math.min(cx, player.x + half));
        const nearestY = Math.max(player.y - half, Math.min(cy, player.y + half));
        const dx = cx - nearestX, dy = cy - nearestY;
        if (dx * dx + dy * dy < rad * rad) die(state);
      } else if (ch === "o" || ch === "p" || ch === "U") {
        // pads and catapults: launch you toward whichever way is UP right now.
        // You reach into the pad from the side gravity is pulling you.
        const power = ch === "o" ? CONFIG.PAD_POWER : ch === "p" ? CONFIG.SMALL_PAD_POWER : CONFIG.CATAPULT_POWER;
        const reached = state.gravityDir > 0 ? (player.y + half > ty + T * 0.4)
                                             : (player.y - half < ty + T * 0.6);
        if (overlapX && reached) {
          player.vy = -power * state.gravityDir; player.onGround = false;
          state.events.push(ch === "U" ? "catapult" : "pad");
        }
      } else if (ch === "*") {
        const key = col + "," + row;
        if (!state.coinsGot.has(key) && overlapX && overlapY) { state.coinsGot.add(key); state.events.push("coin"); }
      } else if (ch === "@") {
        // checkpoint: quietly save this spot as your new respawn point
        if (overlapX && overlapY) dropTileCheckpoint(state, col, row);
      } else if (ch === "|") {
        if (player.x + half > tx) win(state);
      } else if (ch === "=" || ch === "-") {
        // Jump-through platform: land on it only from the side gravity pulls you,
        // and pass right through it the other way. It never kills.
        if (overlapX) {
          if (state.gravityDir > 0) {                   // normal: land on the top
            const prevBottom = player.y + half - player.vy * dt;
            if (player.vy >= 0 && prevBottom <= ty + 6) {
              player.y = ty - half; player.vy = 0; player.onGround = true;
              player.rot = Math.round(player.rot / 90) * 90;
            }
          } else {                                      // flipped: land on the underside
            const slabBot = ty + T / 3;                 // the slab sits in the top third
            const prevTop = player.y - half - player.vy * dt;
            if (player.vy <= 0 && prevTop >= slabBot - 6) {
              player.y = slabBot + half; player.vy = 0; player.onGround = true;
              player.rot = Math.round(player.rot / 90) * 90;
            }
          }
        }
        // A  -  bridge is a platform that fades away once you've run past it.
        // Just a look — a faded bridge still holds you up exactly the same.
        if (ch === "-" && player.x > tx + T * 0.5 && state.bridgeFades[col + "," + row] === undefined) {
          state.bridgeFades[col + "," + row] = 1;   // 1 = fully visible; draw() counts it down to 0
        }
      }
    }
  }

  // Ran off the TOP of a  /  into open air? Give a little upward pop.
  // (We check this AFTER the tile pass so walking straight onto a block or the
  // floor — where onGround is now true — does NOT pop you. 0 = disabled.)
  if (wasOnRampUp && !player.onGround && player.vy >= 0) {
    player.vy = -CONFIG.RAMP_LAUNCH * CONFIG.SCROLL_SPEED;
  }

  // fell past end of level with no finish line? win anyway
  if (player.x / T > state.level.cols + 3) win(state);

  if (CONFIG.TRAIL && (state.trail.length === 0 || Math.abs(state.trail[state.trail.length - 1].x - player.x) > 6)) {
    state.trail.push({ x: player.x, y: player.y, life: 1 });
    if (state.trail.length > 40) state.trail.shift();
  }
}

// A jump the player asked for (a tap or the space bar). Only works with your
// feet on the ground. Returns true if it actually jumped, so the caller can
// make the jump sound right away. Which way "up" is depends on gravity.
export function requestJump(state) {
  const player = state.player;
  if (player.dead || player.won) return false;
  if (player.onGround) {
    player.vy = -CONFIG.JUMP_POWER * state.gravityDir;
    player.onGround = false;
    return true;
  }
  return false;
}

// ---------------- Internals ----------------

// You died. Mark it once and leave a note; the game loop makes the sound,
// shakes the screen, and explodes the cube.
function die(state) {
  if (state.player.dead) return;
  state.player.dead = true;
  state.events.push("die");
}

// You reached the finish (or ran off the end). Mark it once and leave a note.
function win(state) {
  if (state.player.won) return;
  state.player.won = true;
  state.events.push("win");
}

// Look down a whole column for a speed portal ( >  or  < ). Returns the character,
// or null. Portals fill the column, so height doesn't matter — any row counts.
function portalInColumn(state, col) {
  if (col < 0 || col >= state.level.cols) return null;
  for (let row = 0; row < state.level.rows; row++) {
    const ch = state.level.grid[row][col];
    if (ch === ">" || ch === "<") return ch;
  }
  return null;
}
// Same idea for gravity portals:  u  flips gravity,  n  sets it back to normal.
function gravityPortalInColumn(state, col) {
  if (col < 0 || col >= state.level.cols) return null;
  for (let row = 0; row < state.level.rows; row++) {
    const ch = state.level.grid[row][col];
    if (ch === "u" || ch === "n") return ch;
  }
  return null;
}

// Touching a  @  quietly saves where you are (position, speed, and gravity)
// as your new respawn point, and lights up that flag.
function dropTileCheckpoint(state, col, row) {
  const player = state.player;
  state.tileCheckpoint = {
    x: player.x, y: player.y, vy: player.vy, rot: player.rot,
    onGround: player.onGround, camX: state.camX,
    coins: new Set(state.coinsGot),    // the coins you'd grabbed by this point
    speedMult: state.speedMult,        // how fast you were going
    gravityDir: state.gravityDir,      // and which way gravity was pointing
  };
  state.activatedCheckpoints.add(col + "," + row);   // this flag now shows up lit
}
