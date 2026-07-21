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
//   { player, camX, speedMult, gravityDir, flying, holding, groundOn,
//     level, coinsGot, trail, bridgeFades, tileCheckpoint,
//     activatedCheckpoints, events }
//
// `flying` is false for a normal cube and true between an  f  gate and a
// c  gate, when the cube becomes a little rocket. `holding` is simply
// "is a finger (or the space bar) held down right now?" — that's what
// makes a flying cube climb.

import { CONFIG } from "../config.js";
import { tileAt, cellTop, skyTop, worldBottom } from "./level.js";

// The physics runs at a fixed 240 steps a second, no matter how fast
// the screen draws, so the game feels exactly the same on every tablet.
export const FIXED_DT = 1 / 240;

// Move the world forward by one tiny step `dt`.
export function stepPhysics(state, dt) {
  const player = state.player;
  if (player.dead || player.won) return;
  const T = CONFIG.TILE, half = CONFIG.PLAYER_SIZE / 2;

  const prevX = player.x;                    // remember where we were, for portal crossings
  const prevY = player.y;                    // ...and how high, so the ground can't grab us from below
  const wasOnGround = player.onGround;       // ...and whether we had our feet down, for the flip
  player.x += CONFIG.SCROLL_SPEED * state.speedMult * dt;
  state.camX += CONFIG.SCROLL_SPEED * state.speedMult * dt;
  if (state.flying) {
    // Rocket mode: hold the button and you push toward whichever way is UP right
    // now; let go and you just fall. Multiplying the whole push by gravityDir is
    // what makes a  u  gate flip your rocket too, with no extra code.
    const push = state.holding ? -CONFIG.FLY_THRUST : CONFIG.GRAVITY;
    player.vy += push * state.gravityDir * dt;
    // A rocket can only climb or dive so fast.
    if (player.vy >  CONFIG.FLY_MAX_SPEED) player.vy =  CONFIG.FLY_MAX_SPEED;
    if (player.vy < -CONFIG.FLY_MAX_SPEED) player.vy = -CONFIG.FLY_MAX_SPEED;
  } else {
    player.vy += CONFIG.GRAVITY * state.gravityDir * dt; // gravityDir flips which way "down" pulls
  }
  player.y += player.vy * dt;

  // ---- portals: gates that fill a whole column and fire when the cube's CENTER
  // crosses the column's middle (so they work at any height). A  >  speeds the
  // world up, a  <  slows it down — absolute, not stacking (the newest one wins).
  {
    const colA = Math.floor(prevX / T) - 1, colB = Math.floor(player.x / T) + 1;
    for (let col = colA; col <= colB; col++) {
      const mid = col * T + T / 2;
      if (prevX < mid && player.x >= mid) {   // just crossed this column's midline
        const p = portalInColumn(state, col);
        if (p === ">") state.speedMult = CONFIG.FAST_MULT;
        else if (p === "<") state.speedMult = CONFIG.SLOW_MULT;
        const g = gravityPortalInColumn(state, col);  // u = flip gravity, n = back to normal (absolute)
        if (g === "u") state.gravityDir = -1;
        else if (g === "n") state.gravityDir = 1;
        const f = flightPortalInColumn(state, col);   // f = fly like a rocket, c = back to a cube
        if (f === "f") state.flying = true;
        else if (f === "c") state.flying = false;
        const gr = groundPortalInColumn(state, col);  // h = open a hole, g = ground back (absolute)
        if (gr === "h") state.groundOn = false;
        else if (gr === "g") state.groundOn = true;
      }
    }
  }

  // spin in the air, snap when landed — but a flying cube doesn't spin at all:
  // it tips its nose toward wherever it's heading, like a little plane.
  if (state.flying) {
    const tip = (player.vy / CONFIG.FLY_MAX_SPEED) * CONFIG.FLY_TILT;
    player.rot = Math.max(-CONFIG.FLY_TILT, Math.min(CONFIG.FLY_TILT, tip));
  } else if (!player.onGround) {
    player.rot += CONFIG.SPIN_SPEED * dt;
    // Dropping off the edge of a block is one tidy quarter-turn, not a free
    // spin: flipTo is the angle we stop at (see the bottom of this function).
    if (player.flipTo != null && player.rot > player.flipTo) player.rot = player.flipTo;
  }

  player.onGround = false;

  const yCeil = skyTop(state.level);                  // the roof of the world, mirroring the floor
  // The GROUND is whichever surface gravity pulls you onto: normally the floor
  // at the bottom (y = 0), upside-down the roof at the top. An  h  gate switches
  // that ground OFF — a hole with nothing to stand on — and a  g  gate builds it
  // back. The other side of the world was never ground; it only stops you while
  // you're flying, so a rocket can't shoot out of the top of the level.
  const groundIsFloor = state.gravityDir > 0;
  const floorSolid = state.groundOn || !groundIsFloor;  // the floor is "ground" only when gravity is normal
  const roofSolid  = state.groundOn ||  groundIsFloor;  // upside-down, the roof is the ground instead

  // You can land ON a surface, but you can never come back UP through it — the
  // same rule as the jump-through platforms ( = ). Once you have dropped RIGHT
  // past where the ground is, it can't catch you any more. This only ever
  // matters over a hole: it is what stops a  g  gate from scooping up a cube
  // that has already fallen past where the ground is about to come back.
  const notPastFloor = prevY - half <= 0;
  const notPastRoof  = prevY + half >= yCeil;

  // While FLYING both surfaces are soft walls: you slide along them and stop,
  // you never die on them, and you never "land" (so tapping can't become a jump).
  if (state.flying) {
    if (floorSolid && notPastFloor && player.y + half >= 0)     { player.y = -half;       if (player.vy > 0) player.vy = 0; }
    if (roofSolid  && notPastRoof  && player.y - half <= yCeil) { player.y = yCeil + half; if (player.vy < 0) player.vy = 0; }
  } else if (groundIsFloor) {
    if (floorSolid && notPastFloor && player.y + half >= 0) {
      player.y = -half; player.vy = 0; player.onGround = true;
      landRotation(player);
    }
  } else {
    if (roofSolid && notPastRoof && player.y - half <= yCeil) {
      player.y = yCeil + half; player.vy = 0; player.onGround = true;
      landRotation(player);
    }
  }

  // Fallen off the BOTTOM OF THE SCREEN? Then you have left the world, and that's
  // the end. A hole ( h ) is a real hole: you drop right past where the floor
  // would have been, in plain sight, and only leaving the screen kills you. Note
  // there is no "is the ground off?" test here on purpose — with the ground on you
  // could never have got down there anyway, and a  g  putting the floor back over
  // your head once you are below it does not save you. (Upside-down, the roof of
  // the world already IS the top of the screen, so up there it is the very same
  // rule with no extra room to spare.)
  const fellOut = groundIsFloor ? (player.y - half > worldBottom(state.level))
                                : (player.y + half < yCeil);
  if (fellOut) die(state);

  // columns near the player (used by both the ramp pass and the tile pass)
  const c0 = Math.floor((player.x - half) / T) - 1, c1 = Math.floor((player.x + half) / T) + 1;

  // ---- ramps: sloped ground that only ever pushes you UP, never kills ----
  // We do this BEFORE the block/spike pass so a ramp lifts the cube onto a
  // block stack instead of the block's side killing it.
  //
  // There are two families of ramps: the floor ones ( / and \ ) you run up with
  // normal gravity, and the ceiling ones ( L and 7 ) you run along hanging
  // upside-down after a  u  gate. Only the family that matches the way gravity
  // is pointing does anything; the other one is simply not there (and, like
  // every ramp, never deadly). Multiplying by gravityDir mirrors the whole test,
  // so there is ONE piece of code for both — not two.
  const wasOnRampUp = player.onRamp === 1;   // remember, so we can launch off the top of a /
  player.onRamp = 0;
  const up = state.gravityDir;               // +1 = normal (up is -y), -1 = flipped (up is +y)
  const jumping = player.vy * up < 0;        // heading upward (a jump or pad) always beats the ramp glue
  const rampUp   = up > 0 ? "/"  : "L";      // the ramp that CLIMBS as you run right
  const rampDown = up > 0 ? "\\" : "7";      // and the one that goes back down
  // Ramps do nothing at all while flying (a rocket has no feet) — see CLAUDE.md.
  for (let col = c0; !state.flying && col <= c1; col++) {
    for (let row = 0; row < state.level.rows; row++) {
      const ch = tileAt(state.level, col, row);
      if (ch !== rampUp && ch !== rampDown) continue;
      const tx = col * T, ty = cellTop(state.level, row);
      // only care when the cube's CENTER is over this ramp column (kind on purpose)
      if (player.x < tx || player.x >= tx + T) continue;
      // Where the slope is, a fraction f of the way across this square (0 at the
      // left edge, 1 at the right). The climbing ramps ( / and L ) are mirror
      // images of each other, and so are the two that go down.
      const climbs = (ch === rampUp) === (up > 0);
      const slopeAt = (f) => climbs ? ty + T - f * T : ty + f * T;
      const surfaceY = slopeAt((player.x - tx) / T);
      const feet = player.y + half * up;    // the edge of the cube gravity is pulling toward
      // Where those feet were, and where the slope was under them, one step ago.
      const prevFeet = feet - player.vy * dt;
      const wasSurfaceY = slopeAt(Math.max(0, Math.min(1, (prevX - tx) / T)));
      // A ramp is GROUND, and you only ever meet ground from above. If our feet
      // were already below the slope a moment ago then we are running UNDERNEATH
      // this ramp — and a ramp you are under simply isn't there, so you run
      // straight past it. That's what lets a level have a high road and a low
      // road. (Running up a ramp, or sliding down one, our feet were sitting
      // right ON the slope a moment ago, so those still count as "from above".)
      const fromAbove = up > 0 ? prevFeet <= wasSurfaceY + CONFIG.RAMP_GLUE
                               : prevFeet >= wasSurfaceY - CONFIG.RAMP_GLUE;
      // stick to the slope: cube sitting on it, sunk into it, or within RAMP_GLUE of it
      const stuck = up > 0 ? feet >= surfaceY - CONFIG.RAMP_GLUE
                           : feet <= surfaceY + CONFIG.RAMP_GLUE;
      if (!jumping && stuck && fromAbove) {
        player.y = surfaceY - half * up;
        if (player.vy * up > 0) player.vy = 0;
        player.onGround = true;
        player.onRamp = ch === rampUp ? 1 : -1;
        player.rot = (player.onRamp === 1 ? -45 : 45) * up;   // tilt the cube to match the slope
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
        if (state.flying) {
          // Flying, a block's top and underside are soft walls, just like the
          // floor and the roof of the world: you scrape along them and stop, and
          // you never die on them. Its SIDES are still the end of the run.
          // Notice we never set onGround — a rocket doesn't land on things, and
          // that one fact is what stops a tap from becoming a jump.
          const prevBottom = player.y + half - player.vy * dt;
          const prevTop    = player.y - half - player.vy * dt;
          if (player.vy >= 0 && prevBottom <= ty + 6) {
            player.y = ty - half; player.vy = 0;        // scraping along the top
          } else if (player.vy <= 0 && prevTop >= ty + T - 6) {
            player.y = ty + T + half; player.vy = 0;    // bonking the underside
          } else {
            die(state);                                 // flew into the side
          }
        } else if (state.gravityDir > 0) {
          // normal: land on the TOP if we were above it last step and falling down
          const prevBottom = player.y + half - player.vy * dt;
          if (player.vy >= 0 && prevBottom <= ty + 6) {
            player.y = ty - half; player.vy = 0; player.onGround = true;
            landRotation(player);
          } else if (!player.onRamp && !rampBeside(state, col, row)) {
            die(state);                                 // hit the side or bottom
          }
        } else {
          // flipped: land on the UNDERSIDE if we were below it last step and falling up
          const prevTop = player.y - half - player.vy * dt;
          if (player.vy <= 0 && prevTop >= ty + T - 6) {
            player.y = ty + T + half; player.vy = 0; player.onGround = true;
            landRotation(player);
          } else if (!player.onRamp && !rampBeside(state, col, row)) {
            die(state);                                 // hit the side or top
          }
        }
        // If a ramp is holding us up (onRamp), a block beside us must NOT kill:
        // the ramp is carrying us up the side of the stack onto its top. And if
        // we JUMPED off that ramp we are no longer "on" it, but we are still in
        // the same corner — that's what rampBeside asks about.
      } else if (ch === "^" || ch === "v") {
        // forgiving spike hitbox: a smaller box in the middle. A  v  is simply a
        // ^  turned upside down — it hangs from the TOP of its square instead of
        // standing on the bottom — so the only difference is which end of the box
        // is flush with the square. Both kill whichever way gravity is pointing.
        const m = T * CONFIG.SPIKE_MERCY;
        const hx = tx + m, hw = T - 2 * m;
        const hy = ch === "^" ? ty + m : ty, hh = T - m;
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
        // They do nothing at all while flying — they're made for feet.
        if (state.flying) continue;
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
        // and pass right through it the other way. It never kills. While flying
        // you sail straight through it — a rocket doesn't land on things.
        if (overlapX && !state.flying) {
          // You land only if you actually REACHED the slab this step: you were
          // above it a moment ago and you have just touched it. Without that
          // second half you would be snatched down onto it from any height, and
          // a jump over a bridge would look like it got cut short.
          if (state.gravityDir > 0) {                   // normal: land on the top
            const prevBottom = player.y + half - player.vy * dt;
            if (player.vy >= 0 && player.y + half >= ty && prevBottom <= ty + 6) {
              player.y = ty - half; player.vy = 0; player.onGround = true;
              landRotation(player);
            }
          } else {                                      // flipped: land on the underside
            const slabBot = ty + T / 3;                 // the slab sits in the top third
            const prevTop = player.y - half - player.vy * dt;
            if (player.vy <= 0 && player.y - half <= slabBot && prevTop >= slabBot - 6) {
              player.y = slabBot + half; player.vy = 0; player.onGround = true;
              landRotation(player);
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
  if (!state.flying && wasOnRampUp && !player.onGround && player.vy * up >= 0) {
    player.vy = -CONFIG.RAMP_LAUNCH * CONFIG.SCROLL_SPEED * up;
  }

  // Just walked off the edge of a block? That's one tidy quarter-turn, not a
  // free spin. A jump, a pad, a catapult or a ramp pop all send you UP, so those
  // still spin the whole way round. (Multiplying by gravityDir asks "are we
  // heading DOWNWARDS?" in a way that works upside-down too.)
  if (!state.flying && wasOnGround && !player.onGround && player.vy * state.gravityDir >= 0) {
    player.flipTo = Math.round(player.rot / 90) * 90 + 90;   // the next quarter-turn along
  }
  if (player.onGround) player.flipTo = null;                 // feet down: ready for the next drop

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
  if (state.flying) return false;   // flying, HOLDING the button is what lifts you — not a tap
  if (player.onGround) {
    player.vy = -CONFIG.JUMP_POWER * state.gravityDir;
    player.onGround = false;
    return true;
  }
  return false;
}

// ---------------- Internals ----------------

// You landed. Line the cube back up with the world — and if it was part-way
// through a quarter-turn from dropping off a block, finish that turn, so every
// drop ends as a neat 90° flip.
function landRotation(player) {
  player.rot = (player.flipTo != null) ? player.flipTo : Math.round(player.rot / 90) * 90;
  player.flipTo = null;
}

// Is the cube on a ramp right NEXT DOOR to this block? A ramp's slope is lower
// than the top of the block it climbs to, so a cube on the slope is always
// poking a little way into that block — and the moment you JUMP, onRamp switches
// off while you are still standing in that same corner. That's the ramp doing
// its job, not a crash, so a block right beside a ramp must never kill you from
// the side. Only the ramp family that matches the way gravity points counts
// ( / \ normally, L 7 upside-down), just like the ramp pass above.
//
// It must be the SAME ROW, right next door: a block one row HIGHER is a real
// wall, and running into that still ends the run. And we must be on the ramp's
// own side of it, not running along underneath — a ramp we are under isn't
// holding us up, so that block really is a wall.
function rampBeside(state, col, row) {
  const T = CONFIG.TILE, half = CONFIG.PLAYER_SIZE / 2, x = state.player.x;
  const up = state.gravityDir;
  const rampUp   = up > 0 ? "/"  : "L";
  const rampDown = up > 0 ? "\\" : "7";
  const feet = state.player.y + half * up;
  for (const c of [col - 1, col + 1]) {          // the square before and after the block
    const ch = tileAt(state.level, c, row);
    if (ch !== rampUp && ch !== rampDown) continue;
    const tx = c * T, ty = cellTop(state.level, row);
    if (x + half <= tx || x - half >= tx + T) continue;      // not over that ramp at all
    const farEdge = up > 0 ? ty + T : ty;   // the bottom of the ramp square (its top, upside-down)
    if ((feet - farEdge) * up <= CONFIG.RAMP_GLUE) return true;   // we're on it, not under it
  }
  return false;
}

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

// Same idea once more:  f  turns you into a rocket,  c  turns you back into a cube.
function flightPortalInColumn(state, col) {
  if (col < 0 || col >= state.level.cols) return null;
  for (let row = 0; row < state.level.rows; row++) {
    const ch = state.level.grid[row][col];
    if (ch === "f" || ch === "c") return ch;
  }
  return null;
}

// And once more for the ground gates:  h  opens a hole,  g  fills it back in.
function groundPortalInColumn(state, col) {
  if (col < 0 || col >= state.level.cols) return null;
  for (let row = 0; row < state.level.rows; row++) {
    const ch = state.level.grid[row][col];
    if (ch === "h" || ch === "g") return ch;
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
    gravityDir: state.gravityDir,      // which way gravity was pointing
    flying: state.flying,              // whether you were a rocket or a cube
    groundOn: state.groundOn,          // and whether there was any ground under you
  };
  state.activatedCheckpoints.add(col + "," + row);   // this flag now shows up lit
}
