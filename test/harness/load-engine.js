// ============================================================
// load-engine.js — hand the golden harness the pure physics.
// ============================================================
// The simulation now lives in three plain, browser-free modules:
// js/config.js, js/game/level.js, and js/game/physics.js. This
// glues them together (dropping the import/export keywords) and runs
// them in Node's built-in "vm" so the test can call stepPhysics and
// requestJump directly. No fake browser needed anymore — the physics
// is pure, so there is nothing to stub.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Turn an ES-module source file into plain script text: drop its `import`
// lines and its `export ` keywords, so we can glue several modules together
// and run them as one classic script.
function toClassic(src) {
  return src
    .replace(/import\s+[\s\S]*?from\s*["'][^"']+["']\s*;/g, "")   // drop `import ... from "...";`
    .replace(/^(\s*)export\s+/gm, "$1");                          // drop the `export ` keyword
}

// Build the pure physics and hand back the pieces the harness drives.
function loadPhysics() {
  const pub = path.join(__dirname, "..", "..", "public");
  const config = fs.readFileSync(path.join(pub, "js", "config.js"), "utf8");
  const level = fs.readFileSync(path.join(pub, "js", "game", "level.js"), "utf8");
  const physics = fs.readFileSync(path.join(pub, "js", "game", "physics.js"), "utf8");

  // config first (level uses CONFIG), then level (physics uses tileAt/cellTop),
  // then physics. A tiny line at the end hands the controls back out.
  const handOut = "\n;globalThis.__hh = { CONFIG, FIXED_DT, parseLevel, stepPhysics, requestJump };\n";
  const src = toClassic(config) + "\n" + toClassic(level) + "\n" + toClassic(physics) + handOut;

  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "hyper-hop-physics.js" });

  if (!sandbox.__hh) throw new Error("Physics loaded but did not hand back its controls.");
  return sandbox.__hh;
}

module.exports = { loadPhysics };
