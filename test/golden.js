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
const { loadEngine } = require("./harness/load-engine");
const { FIXTURES } = require("./fixtures/levels");

const STEPS = 2400;        // how many physics steps to run each level (~ a full run)
const SAMPLE_EVERY = 8;    // write down the cube's state every this many steps
const GOLDEN_DIR = path.join(__dirname, "golden");

// Run one fixture and return its trace as a pretty, stable string.
// Same engine + same fixture always gives the exact same text.
function traceFor(hh, fixture) {
  hh.startLevel(hh.parseLevel(fixture.level), false, false, fixture.song || 0, 0, null);

  const jumpSteps = new Set(fixture.jumpAt || []);
  const samples = [];
  for (let step = 0; step <= STEPS; step++) {
    if (jumpSteps.has(step)) hh.jump();
    if (step % SAMPLE_EVERY === 0) {
      const p = hh.player;
      samples.push({
        step: step,
        x: p.x, y: p.y, vy: p.vy, rot: p.rot,
        onGround: p.onGround, onRamp: p.onRamp,
        dead: p.dead, won: p.won,
        coins: hh.coinsGot.size,
        camX: hh.camX,
        gravityDir: hh.gravityDir,
        speedMult: hh.speedMult,
      });
    }
    hh.physicsStep(hh.FIXED_DT);
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

  const hh = loadEngine();
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
