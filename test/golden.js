// ============================================================
// golden.js — the "did the physics change?" safety net.
// ============================================================
// This plays every fixture level with the REAL engine, tapping
// jump on a fixed schedule, and writes down where the cube is
// every few steps. That list of positions is a "golden trace".
//
//   node test/golden.js          → (re)write the golden traces
//   node test/golden.js --check  → replay and compare to the saved
//                                  traces; exit 1 if ANYTHING differs
//
// The rule for this whole refactor: after every change, the traces
// must stay byte-for-byte identical. If --check ever fails, the
// change altered how the game plays — stop and find out why. Never
// "fix" a failure by regenerating the traces unless you MEANT to
// change the game.

"use strict";

const fs = require("fs");
const path = require("path");
const { loadPhysics } = require("./harness/load-engine");
const { FIXTURES } = require("./fixtures/levels");

const STEPS = 2400;        // how many physics steps to run each level (~ a full run)
const SAMPLE_EVERY = 8;    // write down the cube's state every this many steps
const GOLDEN_DIR = path.join(__dirname, "golden");

// A fresh sim state at the start of a level — exactly what the game's
// resetRun() sets up: the cube waits a few tiles to the left, gravity is
// normal, speed is normal, no coins yet.
function newState(hh, fixture) {
  const T = hh.CONFIG.TILE;
  const camX = -T * 5;                          // little run-up before the level starts
  return {
    level: hh.parseLevel(fixture.level),
    player: { x: camX + T * 2, y: 0, vy: 0, rot: 0, onGround: true, onRamp: 0, flipTo: null, dead: false, won: false },
    camX: camX,
    speedMult: 1,
    gravityDir: 1,
    flying: false,        // a cube, not a rocket (an  f  gate turns this on)
    holding: false,       // no finger down yet (the hold script below drives this)
    groundOn: true,       // there is ground to stand on (an  h  gate opens a hole)
    coinsGot: new Set(),
    trail: [],
    bridgeFades: {},
    tileCheckpoint: null,
    activatedCheckpoints: new Set(),
    events: [],
  };
}

// Run one fixture through the pure physics and return its trace as a pretty,
// stable string. Same physics + same fixture always gives the exact same text.
function traceFor(hh, fixture) {
  const state = newState(hh, fixture);
  const jumpSteps = new Set(fixture.jumpAt || []);
  // The hold script: pairs of [fromStep, toStep] where a finger is held down.
  // Tapping is what a cube needs; HOLDING is what a rocket needs.
  const holdRanges = fixture.holdAt || [];
  const samples = [];
  for (let step = 0; step <= STEPS; step++) {
    if (jumpSteps.has(step)) hh.requestJump(state);
    state.holding = holdRanges.some(r => step >= r[0] && step < r[1]);
    if (step % SAMPLE_EVERY === 0) {
      const p = state.player;
      samples.push({
        step: step,
        x: p.x, y: p.y, vy: p.vy, rot: p.rot,
        onGround: p.onGround, onRamp: p.onRamp,
        dead: p.dead, won: p.won,
        coins: state.coinsGot.size,
        camX: state.camX,
        gravityDir: state.gravityDir,
        speedMult: state.speedMult,
      });
    }
    hh.stepPhysics(state, hh.FIXED_DT);
    state.events.length = 0;   // the harness ignores the physics' sound/splash notes
  }

  // Build the text by hand so the newlines are always "\n" (never
  // Windows "\r\n"), so the saved file matches on every computer.
  const lines = [];
  lines.push("{");
  lines.push('  "fixture": ' + JSON.stringify(fixture.name) + ",");
  lines.push('  "steps": ' + STEPS + ",");
  lines.push('  "sampleEvery": ' + SAMPLE_EVERY + ",");
  lines.push('  "samples": [');
  for (let i = 0; i < samples.length; i++) {
    lines.push("    " + JSON.stringify(samples[i]) + (i < samples.length - 1 ? "," : ""));
  }
  lines.push("  ]");
  lines.push("}");
  return lines.join("\n") + "\n";
}

function main() {
  const check = process.argv.includes("--check");
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  const hh = loadPhysics();
  let failures = 0;

  for (const fixture of FIXTURES) {
    const text = traceFor(hh, fixture);
    const file = path.join(GOLDEN_DIR, fixture.name + ".json");

    if (check) {
      let saved = null;
      try { saved = fs.readFileSync(file, "utf8"); } catch (e) { saved = null; }
      if (saved === null) {
        console.log("MISSING  " + fixture.name + "  (no saved trace — run without --check first)");
        failures++;
      } else if (saved !== text) {
        console.log("CHANGED  " + fixture.name + "  (physics differs from the saved trace!)");
        failures++;
      } else {
        console.log("ok       " + fixture.name);
      }
    } else {
      fs.writeFileSync(file, text);
      console.log("wrote    " + fixture.name + ".json");
    }
  }

  if (check) {
    if (failures) {
      console.log("\n" + failures + " trace(s) changed. The refactor altered the game — investigate before committing.");
      process.exit(1);
    }
    console.log("\nAll traces identical. The game plays exactly the same. ✅");
  } else {
    console.log("\nWrote " + FIXTURES.length + " golden traces to test/golden/.");
  }
}

main();
