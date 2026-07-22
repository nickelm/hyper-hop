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
// Every name here must be a real top-level thing in main.js. If one gets
// renamed and this list isn't updated, the whole test stops at "the game
// did not load at all" — which is exactly the point.
fs.appendFileSync(path.join(TMP, "main.js"),
  "\nexport { startLevel, leaveGame, parseLevel, draw, jump, stepPhysics, drainSimEvents, simState, gameView, FIXED_DT,\n" +
  "         CONFIG,\n" +
  "         openSkinEditor, buildMenu, buildLoginPicker, showLogin, updateMenuBar, openLeaderboard,\n" +
  "         showScreen, openNewLevel, openLevelForEdit, openAdventures, setLevels, showTab };\n");

/* ---------------- Does every button actually exist? ----------------
   The pretend browser below answers EVERY question with a stand-in, so
   document.getElementById("typoo") looks like it worked. That is the one
   blind spot in this whole test — and it's an easy mistake to make when
   you add a button. So before we run anything, we simply read the real
   index.html and check that every id the code asks for is really in it. */
function checkEveryIdExists() {
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  const inPage = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const missing = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const here = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(here); continue; }
      if (!here.endsWith(".js")) continue;
      const code = fs.readFileSync(here, "utf8");
      for (const m of code.matchAll(/getElementById\("([^"]+)"\)/g)) {
        if (!inPage.has(m[1])) missing.push('"' + m[1] + '" (asked for in ' + path.relative(ROOT, here) + ")");
      }
    }
  })(SRC);
  if (missing.length) {
    console.log("These parts of the page don't exist:\n  " + missing.join("\n  "));
    console.log("\nEither the id is spelled wrong, or index.html is missing that button.");
    process.exit(1);
  }
  console.log("ok  every part of the page the code asks for really exists");
}
checkEveryIdExists();

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
// A pretend localStorage that actually REMEMBERS things, so the code that
// preselects your name on the login screen really runs.
const deviceMemory = new Map();
setGlobal("localStorage", {
  getItem: k => (deviceMemory.has(k) ? deviceMemory.get(k) : null),
  setItem: (k, v) => deviceMemory.set(k, String(v)),
  removeItem: k => deviceMemory.delete(k),
  clear: () => deviceMemory.clear(),
});

/* ---------------- the pretend server ----------------
   Each address answers with the SHAPE the real server sends: a list
   where the game expects a list, an object where it expects an object.
   (The old stub said [] to everything, which quietly turned things like
   "me.coins" into undefined and hid real mistakes.)

   Run with HH_BOOT_LOGGED_OUT=1 and /me answers null instead, so the
   login screen gets exercised too. */
const LOGGED_OUT = process.env.HH_BOOT_LOGGED_OUT === "1";
const FAKE_SKIN = { bodyColor: "#7dff5e", outlineColor: "#ffffff", faceColor: "#05051a",
                    shape: "square", face: "happy", emoji: "😀", trail: "fade", explosion: "squares" };
// The cube a level gives you for finishing it — a look you own, plus the
// green one, so the "My Looks" row really has something to draw.
const FAKE_CROW = { ...FAKE_SKIN, bodyColor: "#101020", shape: "diamond", face: "cool" };
const FAKE_ME = {
  id: 1, name: "Test", role: "admin", skin: FAKE_SKIN,
  coins: 50, coinsEarnedTotal: 120, hasPassword: true,
  collectedCoins: { 1: ["3,1"] },
  looks: [{ skin: FAKE_SKIN, name: "", from: "shop" },
          { skin: FAKE_CROW, name: "The Crow", from: "level" }],
  powers: ["level.create", "level.editOwn", "level.deleteOwn", "level.publishOwn",
           "level.bountyOwn", "level.star", "me.edit", "run.report",
           "level.editAny", "level.deleteAny", "level.hide", "level.publishFree",
           "adventure.manage", "level.reorder", "level.publishAny", "account.editAny"],
};
const FAKE_PRICES = { startingCoins: 50, coinValue: 1, maxCoinsPerLevel: 25,
  publishFee: 15, bountyMin: 5, bountyMax: 100, bountySlots: 3,
  skin: { bodyColor: 5, outlineColor: 5, faceColor: 5, shape: 20, face: 10, emoji: 15, trail: 25, explosion: 25 } };
// The levels the pretend server hands out: one published (with a look, a
// prize on it and some stars) and one still a draft, so the menu really
// draws the star button, the bounty badge, the Draft chip and Publish.
const FAKE_LEVELS = [
  { id: 1, name: "Turbo Canyon", author: "Test", ownerId: 1, level: "..*..|",
    song: 0, theme: 0, status: "listed", starCount: 3, starredByMe: true,
    bounty: { amountPer: 20, slotsLeft: 2, claimedBy: [7] },
    createdAt: "2026-07-01T10:00:00.000Z",
    reward: { name: "The Crow", skin: FAKE_CROW }, rules: { GRAVITY: 9000 } },
  { id: 2, name: "Sleepy Swamp", author: "Test", ownerId: 1, level: "..|",
    song: 1, theme: 2, status: "draft", starCount: 0, starredByMe: false,
    bounty: null, createdAt: "2026-07-02T10:00:00.000Z" },
];
// One adventure, part-way through: the first level beaten, the second one
// the frontier, the third still locked.
const FAKE_ADVENTURES = [
  { id: 1, name: "First Journey", levelIds: [1, 2], createdBy: 1,
    playableIds: [1], completed: [1], frontier: 1, score: 1, total: 2 },
];

function reply(data, status = 200) {
  return Promise.resolve({
    ok: status < 400, status,
    json: async () => data,
    headers: { get: () => null, getSetCookie: () => [] },
  });
}
setGlobal("fetch", (url) => {
  const u = String(url);
  // matches "/api/levels", "/api/levels/3" and "/api/levels/order" alike
  const at = p => u === "/api" + p || u.startsWith("/api" + p + "/") || u.startsWith("/api" + p + "?");
  if (at("/me"))          return reply(LOGGED_OUT ? null : FAKE_ME);
  if (at("/accounts"))    return reply([{ id: 1, name: "Test", role: "admin", skin: FAKE_SKIN,
                                          coins: 50, coinsEarnedTotal: 120, hasPassword: true }]);
  if (at("/login"))       return reply(FAKE_ME);
  if (at("/set-password")) return reply(FAKE_ME);
  if (at("/logout"))      return reply({ ok: true });
  if (at("/levels"))      return reply(FAKE_LEVELS);
  if (at("/scores"))      return reply([{ levelId: 1, accountId: 1, player: "Test", percent: 100 }]);
  if (at("/prices"))      return reply(FAKE_PRICES);
  if (at("/words"))       return reply({ adjectives: ["Turbo", "Wobbly"], nouns: ["Canyon", "Maze"] });
  if (at("/stars"))       return reply({ starred: true, starCount: 4 });
  // "/adventures/1/board" as well as "/adventures" — the board answer is
  // an object where the list is a list, which is the whole point of this
  // stub being shaped like the real thing.
  if (u.includes("/adventures/") && u.endsWith("/board")) {
    return reply({ id: 1, name: "First Journey", total: 2,
      board: [{ id: 1, name: "Test", skin: FAKE_SKIN, score: 1, total: 2, rank: 1 }] });
  }
  if (at("/adventures")) return reply(FAKE_ADVENTURES);
  if (at("/leaderboard")) return reply([{ id: 1, name: "Test", skin: FAKE_SKIN, coinsEarnedTotal: 120 }]);
  if (at("/runs"))        return reply({ credited: 2, balance: 52, coinsEarnedTotal: 122,
                                         bounty: 20,
                                         unlocked: { name: "The Crow", skin: FAKE_CROW } });
  return reply([]);
});
setGlobal("URL", function () { return { pathname: "/" }; });   // api.js reads the page address
process.on("unhandledRejection", () => {});                    // startup fetches fail quietly here

// A level you finish, and a level you die on (so the win AND death screens run).
// The  !  in the win level is a sign, so the sign drawing really runs too.
const WIN_LEVEL =
`....................................................
.........*..........*...............*...............
....................====............................
....................................................
...!................................................
......o......p.......U........-......@.........|....`;
const WIN_MESSAGES = { "3,4": "Jump the spikes and grab the coins!" };
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

  function playFor(what, levelText, messages, extras) {
    check(what, () => {
      game.startLevel(game.parseLevel(levelText, messages), false, false, 0, 2, 1, extras);
      for (let f = 0; f < 800; f++) {
        for (let k = 0; k < 4; k++) game.stepPhysics(game.simState, game.FIXED_DT);
        game.drainSimEvents();
        game.draw(game.gameView, 4 * game.FIXED_DT);
      }
    });
  }
  // Give init() (which runs on import) a moment to finish its fetches, so
  // the game knows who's logged in before we press any buttons.
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));

  if (LOGGED_OUT) {
    // Nobody is logged in: the only thing that should happen is the login
    // screen appearing. Nothing may block waiting for a pop-up.
    check("the login screen builds", () => game.buildLoginPicker());
    check("the login screen shows", () => game.showLogin());
  } else {
    // The win level is played as its own character, so the enforced skin, the
    // "New look!" line on the win screen and the unlock all really run.
    playFor("played a level to the finish (HUD, coins, sign, level look, WIN screen)",
      WIN_LEVEL, WIN_MESSAGES, { reward: { name: "The Crow", skin: FAKE_CROW } });
    playFor("died on a level (explosion, death screen, respawn)", DIE_LEVEL);

    // A level may bend some of the game's numbers while you're inside it, and
    // must hand every one of them back when you leave (see js/rules.js).
    const normalGravity = game.CONFIG.GRAVITY;
    playFor("played a level that bends the rules (moon gravity)", WIN_LEVEL, WIN_MESSAGES,
      { rules: { GRAVITY: 1500 } });
    check("a level's rules are really in force while you play it",
      () => { if (game.CONFIG.GRAVITY !== 1500) throw new Error("GRAVITY is " + game.CONFIG.GRAVITY + ", wanted 1500"); });
    game.leaveGame();
    check("...and are handed back when you leave",
      () => { if (game.CONFIG.GRAVITY !== normalGravity) throw new Error("GRAVITY stayed at " + game.CONFIG.GRAVITY); });

    // The menu list, with one of everything on it: a published level, a
    // draft that only its owner sees, somebody else's level, a level with
    // a look, one with stars and one with a prize on it. Every button on
    // a level row gets drawn at least once.
    const MENU_LEVELS = [
      { id: 1, name: "Bouncy Alley", author: "kid", ownerId: 1, level: "..|", song: 0, theme: 0,
        status: "listed", starCount: 2, starredByMe: false, createdAt: "2026-07-01T00:00:00.000Z",
        bounty: { amountPer: 20, slotsLeft: 2, claimedBy: [] } },
      { id: 2, name: "Frozen Rush", author: "kid", ownerId: 2, level: "..|", song: 1, theme: 2,
        status: "listed", starCount: 5, starredByMe: true, createdAt: "2026-07-02T00:00:00.000Z" },
      // one that carries a look, so the 🎭 / 🔒 line on the button is drawn too
      { id: 3, name: "The Crow Flies", author: "kid", ownerId: 1, level: "..|", song: 0, theme: 0,
        status: "listed", starCount: 0, createdAt: "2026-07-03T00:00:00.000Z",
        reward: { name: "The Crow", skin: FAKE_CROW } },
      // ...a draft of my own (the ⇧ Publish button)...
      { id: 4, name: "Sneaky Maze", author: "kid", ownerId: 1, level: "..|", song: 0, theme: 0,
        status: "draft", starCount: 0, createdAt: "2026-07-04T00:00:00.000Z" },
      // ...and one a curator has taken off the list.
      { id: 5, name: "Wobbly Tower", author: "kid", ownerId: 1, level: "..|", song: 0, theme: 0,
        status: "hidden", starCount: 1, createdAt: "2026-07-05T00:00:00.000Z" },
    ];
    check("the menu builds", () => game.buildMenu(MENU_LEVELS));
    // ...and again through every tab and every way of sorting, because
    // each one draws a different set of buttons. ("Order" is the only one
    // with the ▲▼ on it, "mine" is the only one showing drafts.)
    check("every tab and sort draws", () => {
      game.setLevels(MENU_LEVELS);
      for (const tab of ["new", "mine"]) {
        for (const sort of ["newest", "stars", "bounty", "order"]) game.showTab(tab, sort);
      }
      game.showTab("new", "newest");
    });
    check("the menu bar builds (your cube + purse)", () => game.updateMenuBar());
    check("the adventures screen opens", () => game.openAdventures());
    check("the login screen builds", () => game.buildLoginPicker());
    check("the trophy board opens", () => game.openLeaderboard());
    check("screens switch", () => {
      game.showScreen("loginScreen"); game.showScreen("menuScreen"); game.showScreen("editorScreen");
    });
    check("the cube editor opens (with My Looks)", () => game.openSkinEditor({ id: 1, name: "Test", skin: {} }));
    // ...and again in the other mode, where the level editor borrows it to
    // design the cube a level is played as.
    check("the cube editor opens for a level's look", () => game.openSkinEditor(
      { id: 1, name: "Test", skin: {} },
      { forLevel: true, name: "The Crow", skin: FAKE_CROW, onDone: () => {}, onCancel: () => {} }));
    check("the level editor opens (new level)", () => game.openNewLevel());
    check("the level editor opens (editing a saved level)", () => game.openLevelForEdit(
      { id: 1, name: "L", author: "kid", ownerId: 1, level: "..#..\n..^..|", song: 1, theme: 2 }));
    // The same again with the newer bits: ceiling ramps, a sign, and the words
    // that go on it (which live beside the grid, not in it).
    check("the level editor opens (ceiling ramps and a sign)", () => game.openLevelForEdit(
      { id: 2, name: "Upside down", author: "kid", ownerId: 1, song: 0, theme: 0,
        level: "..L7.!\n..u..|", messages: { "5,0": "Mind your head!" } }));
    // ...and one that bends the rules, so the ⚙ Rules pop-up really builds.
    check("the level editor opens (a level with its own rules)", () => {
      game.openLevelForEdit({ id: 3, name: "Moon Hop", author: "kid", ownerId: 1, level: "..|",
                              song: 0, theme: 0, rules: { GRAVITY: 1500, FLY_THRUST: 4200 } });
      document.getElementById("rulesBtn").onclick();
    });
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  if (problem) {
    console.log("\nSomething is missing:\n" + problem);
    console.log("\nUsually this means code moved to another file and something still points at the old place.");
    process.exit(1);
  }

  // Now do the whole thing again pretending nobody is logged in, so the
  // login screen is tested too. It has to be a FRESH process: a module
  // only ever loads once, so we can't just change our minds in here.
  if (!LOGGED_OUT) {
    console.log("\n--- again, with nobody logged in ---");
    const { status } = require("child_process").spawnSync(
      process.execPath, [__filename],
      { env: { ...process.env, HH_BOOT_LOGGED_OUT: "1" }, stdio: "inherit" });
    if (status !== 0) process.exit(status || 1);
  }

  console.log("\nThe whole game loads and runs. ✅");
})();
