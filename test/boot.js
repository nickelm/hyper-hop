// ============================================================
// boot.js — does the game still hold together?
// ============================================================
// The golden traces only watch the physics. This one watches
// everything else: it loads the REAL modules in public/js (the same
// way a browser does), then actually runs the game with a pretend
// browser — draws hundreds of frames on a level you win and a level
// you die on, and opens the menu, the cube editor and the level
// editor.
//
// It does NOT look at pixels. What it catches is things being MISSING:
// a bad import path, an export that got renamed, or a leftover
// reference to a variable that now lives in another module. Those are
// exactly the mistakes that happen when code moves between files.
//
//   node test/boot.js      (or npm test, which runs this and the traces)
//
// How it works: we copy public/js to a temp folder, add a tiny
// package.json so Node treats the files as modules, and add one line
// to the copy of main.js so this test can reach in and press the
// buttons. Your real files are never touched.

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "public", "js");
const TMP = path.join(os.tmpdir(), "hyper-hop-boot-" + process.pid);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name), b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}
copyDir(SRC, TMP);
fs.writeFileSync(path.join(TMP, "package.json"), '{ "type": "module" }');
fs.appendFileSync(path.join(TMP, "main.js"),
  "\nexport { startLevel, parseLevel, draw, jump, stepPhysics, drainSimEvents, simState, gameView, FIXED_DT,\n" +
  "         openSkinEditor, buildMenu, buildProfilePicker, showScreen, openNewLevel, openLevelForEdit };\n");

// ---------- a pretend browser ----------
// Every browser thing (the page, the canvas, sound, saving) becomes a
// do-nothing stand-in: read any property and you get the same stand-in back,
// call any method and nothing happens. The game can poke at it all it likes.
function makeStub() {
  const target = function () {};
  const stub = new Proxy(target, {
    get(t, prop) {
      if (prop === "then") return undefined;           // not a Promise
      if (prop === Symbol.toPrimitive) return () => 0;  // math on it → 0
      if (prop === Symbol.iterator) return undefined;   // not a list
      return stub;
    },
    set() { return true; }, apply() { return stub; },
    construct() { return stub; }, has() { return true; },
  });
  return stub;
}
const dom = makeStub();
// Node already owns a few of these names (navigator, fetch, URL) and won't let
// us just assign over them, so we define them the long way round.
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
setGlobal("document", dom);
setGlobal("window", dom);
setGlobal("navigator", dom);
setGlobal("performance", { now: () => 0 });
setGlobal("requestAnimationFrame", () => 0);
setGlobal("cancelAnimationFrame", () => {});
setGlobal("setInterval", () => 0);
setGlobal("clearInterval", () => {});
setGlobal("AudioContext", function () { return dom; });
setGlobal("webkitAudioContext", function () { return dom; });
setGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
setGlobal("fetch", () => Promise.resolve({ ok: true, status: 200, json: async () => [] }));
setGlobal("URL", function () { return { pathname: "/" }; });   // api.js reads the page address
process.on("unhandledRejection", () => {});                    // startup fetches fail quietly here

// A level you finish, and a level you die on (so the win AND death screens run).
const WIN_LEVEL =
`....................................................
.........*..........*...............*...............
....................====............................
....................................................
....................................................
......o......p.......U........-......@.........|....`;
const DIE_LEVEL = "...................^.......^....###...###....o......^^...##..........|";

(async () => {
  let game;
  try {
    game = await import("file:///" + path.join(TMP, "main.js").replace(/\\/g, "/"));
  } catch (e) {
    console.log("The game did not load at all:\n" + e.stack);
    process.exit(1);
  }
  console.log("ok  every module loaded (all imports and exports line up)");

  let problem = null;
  function check(what, run) {
    try { run(); console.log("ok  " + what); }
    catch (e) { problem = problem || (what + "\n" + e.stack); }
  }

  function playFor(what, levelText) {
    check(what, () => {
      game.startLevel(game.parseLevel(levelText), false, false, 0, 2, 1);
      for (let f = 0; f < 800; f++) {
        for (let k = 0; k < 4; k++) game.stepPhysics(game.simState, game.FIXED_DT);
        game.drainSimEvents();
        game.draw(game.gameView, 4 * game.FIXED_DT);
      }
    });
  }
  playFor("played a level to the finish (HUD, scores, WIN screen)", WIN_LEVEL);
  playFor("died on a level (explosion, death screen, respawn)", DIE_LEVEL);

  check("the menu builds", () => game.buildMenu([
    { id: 1, name: "Level One", author: "kid", level: "..|", song: 0, theme: 0 },
    { id: 2, name: "Level Two", author: "kid", level: "..|", song: 1, theme: 2 },
  ]));
  check("the player picker builds", () => game.buildProfilePicker());
  check("screens switch", () => { game.showScreen("menuScreen"); game.showScreen("editorScreen"); });
  check("the cube editor opens", () => game.openSkinEditor({ id: null, name: "Test", skin: {} }));
  check("the level editor opens (new level)", () => game.openNewLevel());
  check("the level editor opens (editing a saved level)", () => game.openLevelForEdit(
    { id: 1, name: "L", author: "kid", level: "..#..\n..^..|", song: 1, theme: 2 }));

  fs.rmSync(TMP, { recursive: true, force: true });
  if (problem) {
    console.log("\nSomething is missing:\n" + problem);
    console.log("\nUsually this means code moved to another file and something still points at the old place.");
    process.exit(1);
  }
  console.log("\nThe whole game loads and runs. ✅");
})();
