// ============================================================
// load-engine.js — run the real game engine with no browser.
// ============================================================
// The game currently lives as one big <script> inside
// public/index.html. To test the physics without a browser, we
// read that script out of the HTML, run it inside Node's built-in
// "vm" sandbox, and hand back the few functions the golden harness
// needs (physicsStep, jump, startLevel, ...) plus a peek at the
// player's state.
//
// The sandbox gives the script FAKE versions of everything a browser
// would normally provide (document, canvas, sound, fetch, ...). They
// all do nothing, because the physics doesn't need them — it only
// needs the numbers. This lets the trace capture the REAL engine,
// so a later refactor can be proven identical.
//
// IMPORTANT: this never edits index.html. It only reads it and adds
// a tiny "hand these back" line to an in-memory COPY of the script.

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// A do-nothing stand-in for any browser object (document, an element,
// a canvas context, the audio system, ...). Every property you read
// gives back the same stub, and every method call does nothing. That
// way the engine can poke at "the DOM" all it likes and never crash.
function makeStub() {
  const target = function () {};
  const stub = new Proxy(target, {
    get(t, prop) {
      if (prop === "then") return undefined;          // not a Promise
      if (prop === Symbol.toPrimitive) return () => 0; // math on it → 0
      if (prop === Symbol.iterator) return undefined;  // not iterable
      return stub;
    },
    set() { return true; },
    apply() { return stub; },
    construct() { return stub; },
    has() { return true; },
  });
  return stub;
}

// Pull the inline <script> (the one with no src=) out of index.html.
function readEngineSource() {
  const htmlPath = path.join(__dirname, "..", "..", "public", "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script>\r?\n([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Could not find the inline <script> block in public/index.html");
  return match[1];
}

// Build a fresh, fully-loaded engine and return its controls.
function loadEngine() {
  const engineSource = readEngineSource();

  // A little line added to the END of our COPY of the script. Because it
  // runs inside the same script, it can see the engine's private functions
  // and variables and hand them out. The getters always read the CURRENT
  // value, even after startLevel() makes a brand-new player.
  const handOut = `
    ;globalThis.__hh = {
      CONFIG: CONFIG,
      FIXED_DT: FIXED_DT,
      parseLevel: parseLevel,
      startLevel: startLevel,
      physicsStep: physicsStep,
      jump: jump,
      levelProgress: levelProgress,
      S: S,
      get player() { return player; },
      get camX() { return camX; },
      get speedMult() { return speedMult; },
      get gravityDir() { return gravityDir; },
      get coinsGot() { return coinsGot; },
    };
  `;

  const dom = makeStub();
  const sandbox = {
    document: dom,
    window: dom,
    navigator: dom,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    fetch: () => Promise.resolve({ ok: true, status: 200, json: async () => [] }),
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    AudioContext: function () { return dom; },
    webkitAudioContext: function () { return dom; },
    // new URL(".", document.baseURI) runs when the script loads — give it
    // something harmless so it doesn't blow up without a real page address.
    URL: function () { return { pathname: "/" }; },
    // The music lives in a separate file we don't load here. Music is a
    // do-nothing stub (every method — start, stop, setBpm, ... — is a no-op);
    // SONGS just needs to be a list with a name.
    Music: makeStub(),
    SONGS: [{ name: "Test" }],
    MUSIC: { ON: true, VOLUME: 0.5 },
    console: console,
  };

  // The page's startup code kicks off some background fetches that we let
  // fail quietly; swallow the resulting "unhandled rejection" noise.
  const hushRejections = () => {};
  process.on("unhandledRejection", hushRejections);

  vm.createContext(sandbox);
  vm.runInContext(engineSource + handOut, sandbox, { filename: "hyper-hop-engine.js" });

  process.removeListener("unhandledRejection", hushRejections);

  if (!sandbox.__hh) throw new Error("Engine loaded but did not hand back its controls.");
  return sandbox.__hh;
}

module.exports = { loadEngine };
