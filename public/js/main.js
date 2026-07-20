// ============================================================
// main.js — the game's front door: wire everything together.
// ============================================================
// Imports the pieces (config, level, physics, render, player, effects,
// music) and runs the whole game: the menu, the level editor, the cube
// editor, the Control Panel, the game loop, and the startup fetches.
// (Over the next steps the editor/menu/settings move into js/ui/*,
// leaving this as mostly wiring.)

"use strict";

// Each module owns one job; we import just the bits we use here.
import { CONFIG, DEFAULT_SKIN } from "./config.js";
import { parseLevel } from "./game/level.js";
import { FIXED_DT, stepPhysics, requestJump } from "./game/physics.js";
import { normalizeSkin, drawPlayer } from "./game/player.js";
import { spawnExplosion } from "./game/effects.js";
import { draw } from "./game/render.js";
import { Music, SONGS } from "./music.js";
import { apiGet, apiWrite, apiPost, askConfirm } from "./api.js";
import { initInput } from "./input.js";
import { showToast } from "./ui/toast.js";
import { initSettings, isPanelOpen, openPanel, closePanel } from "./ui/settings.js";
import { initSkins, openSkinEditor } from "./ui/skins.js";
import { initEditor, openLevelForEdit, openNewLevel } from "./ui/editor.js";


/* ================================================================
   ====================  THE LEVELS  ===============================
   ================================================================
   Draw levels with letters! Each letter is one square:

       .  = empty air
       #  = solid block (you can stand on it, but its side kills you)
       /  = ramp up   (run up the slope — a ramp is never deadly)
       \  = ramp down (slide down the slope — a ramp is never deadly)
       ^  = spike (deadly!)
       o  = bounce pad (launches you high)
       *  = coin (collect it!)
       |  = finish line (you win!)
       =  = jump-through platform (land on top; jump up through it from below; never deadly)
       -  = disappearing bridge (works like = , but fades away once you run past it)
       p  = small pad (a gentle bounce — like o but smaller)
       U  = catapult (flings you way up high!)
       s  = saw blade (a spinning circle — deadly!)
       @  = checkpoint (touch it, and a death sends you back here, not the start)
       >  = fast portal (run through to speed the world up)
       <  = slow portal (run through to slow the world down)
       u  = flip-gravity portal (the cube starts falling UP!)
       n  = normal-gravity portal (fall back down again)

   The floor is automatic — you do not need to draw it.
   The bottom row of letters sits right on the floor.
   Rows must all be the same length. Add more rows for taller levels.

   You can also pick which tune plays! Each level remembers a  song  number
   (0, 1, 2...) that chooses from the SONGS list in music.js.
   ================================================================
   Levels no longer live in this file! They now live on the server, in
   data/levels.json, and the game downloads them when it starts up (see
   init() near the bottom). The kids build levels in the editor and tap
   "Save to server", so everyone shares the same list of levels.
   The letters above still describe exactly how a level is drawn.
   ================================================================ */

/* ================================================================
   Everything below here is the game engine. You can read it,
   and you can change it — but save a copy first!
   ================================================================ */

// ---------------- Level parsing ----------------

// ---------------- Canvas setup ----------------
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---------------- Sound (tiny synth) ----------------
let audioCtx = null;
function beep(freq, dur, type = "square", vol = 0.15, slide = 0) {
  if (!CONFIG.SOUND) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, audioCtx.currentTime + dur);
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) {}
}
const sfx = {
  jump:  () => beep(300, 0.12, "square", 0.12, 200),
  pad:   () => beep(400, 0.2, "square", 0.15, 500),
  coin:  () => { beep(900, 0.08, "sine", 0.15); setTimeout(() => beep(1400, 0.12, "sine", 0.15), 70); },
  death: () => beep(180, 0.4, "sawtooth", 0.2, -120),
  win:   () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.18, "square", 0.12), i * 110)),
  // Catapult: a big rising WHOOOMP then a bright pop — nothing else sounds like it.
  catapult: () => { beep(150, 0.32, "sawtooth", 0.22, 950); setTimeout(() => beep(760, 0.16, "square", 0.16, 400), 130); },
};

// ---------------- Game state ----------------
const S = { screen: "menu", level: null, levelId: null, testMode: false, paused: false, practice: false, songIndex: 0, themeIndex: 0, campaign: false, campaignIndex: 0 };
let player, camX, attempts, particles, trail, coinsGot, totalCoins, shake, winT, deadT;
let runPercent = 0;      // how far you got this run (0..100), shown on the death/win screen
let runWasBest = false;  // did this run beat your old best on this level? (for the "NEW BEST!" flash)
let checkpoints = [];   // in practice mode: the flags the player has dropped (newest last)
let beatPulse = 0;      // 0..1, jumps to 1 on the beat then fades (for the beat pulse)

// ---------------- Players & skins ----------------
let profiles = [];        // every saved player, from the server: {id, name, skin}
let currentProfile = null;// who is playing right now; null means "nobody picked" (default cube)
let bridgeFades = {};   // "col,row" -> how visible a  -  bridge still is (1 = solid, 0 = gone). Cosmetic only.
let squash = 0;         // brief squash-and-stretch on the cube after a catapult launch (1 = full, 0 = none). Cosmetic.
let tileCheckpoint = null;         // the last  @  checkpoint you touched (a respawn snapshot), or null
let activatedCheckpoints = new Set(); // "col,row" of every  @  you've lit up this run (for drawing them lit)
let checkpointTagT = 0;            // seconds left to show the little "from checkpoint" tag after a respawn
let speedMult = 1;                 // how fast the world scrolls right now: 1 normal, set by  >  and  <  gates
let gravityDir = 1;                // which way is DOWN: +1 normal (falls toward the floor), -1 flipped (falls up)
let flying = false;                // are you a rocket right now? Set by the  f  and  c  gates
let holding = false;               // is a finger (or the space bar) held down? input.js keeps this up to date

// The music calls this on every step. There are 2 steps per beat, so the
// even ones (0, 2, 4...) are the beats — that's when we flash the world.
Music.onStep = (i) => { if (CONFIG.BEAT_PULSE && i % 2 === 0) beatPulse = 1; };

function startLevel(parsed, isTest, practice, songIndex, themeIndex, levelId) {
  S.level = parsed; S.testMode = !!isTest; S.screen = "game";
  S.paused = false;
  S.practice = !!practice;
  S.songIndex = songIndex || 0;   // which tune from music.js this level plays
  S.themeIndex = themeIndex || 0; // which background theme this level uses
  S.levelId = (levelId != null) ? levelId : null;  // which server level (for high scores); null = a test run, no score
  checkpoints = [];             // fresh level = no checkpoints yet
  attempts = 0;
  resetRun();
  showScreen(null);
  document.getElementById("hud").classList.remove("hidden");
  document.getElementById("attempts").classList.remove("hidden");
  document.getElementById("topLeftBtns").classList.remove("hidden");
  document.getElementById("practiceBtns").classList.toggle("hidden", !S.practice);
}
function resetRun() {
  attempts++;
  document.getElementById("attempts").textContent = "Attempt " + attempts;
  const T = CONFIG.TILE;
  player = { x: 0, y: 0, vy: 0, rot: 0, onGround: true, onRamp: 0, dead: false, won: false };
  camX = -T * 5;                       // little run-up before the level starts
  player.x = camX + T * 2;
  particles = []; trail = []; shake = 0; winT = 0; deadT = 0;
  runPercent = 0; runWasBest = false;
  coinsGot = new Set();
  bridgeFades = {};                    // every  -  bridge is solid again at the start of a run
  squash = 0;                          // no leftover catapult stretch
  tileCheckpoint = null;               // a full restart forgets your  @  checkpoint...
  activatedCheckpoints = new Set();    // ...and all the flags go back to unlit
  checkpointTagT = 0;
  speedMult = 1;                       // back to normal speed
  gravityDir = 1;                      // and normal (downward) gravity
  flying = false;                      // every level starts you as a cube, never a rocket
  totalCoins = 0;
  for (const row of S.level.grid) for (const c of row) if (c === "*") totalCoins++;
  // Restart the tune from the very beginning so obstacles line up with the
  // beat again on every attempt (just like the real rhythm games).
  if (CONFIG.MUSIC) Music.start(S.songIndex, CONFIG.MUSIC_VOLUME);
  else Music.stop();
}

// ---------------- Practice mode checkpoints ----------------
// Drop a flag right where the cube is now. On death you come back here.
function dropCheckpoint() {
  if (S.screen !== "game" || !player || player.dead || player.won) return;
  checkpoints.push({
    x: player.x, y: player.y, vy: player.vy, rot: player.rot,
    onGround: player.onGround, camX: camX,
    coins: new Set(coinsGot),          // remember which coins were already grabbed
    speedMult: speedMult,              // and the speed you were going
    gravityDir: gravityDir,            // and which way gravity pointed
    flying: flying,                    // and whether you were a rocket or a cube
  });
  sfx.coin();
}
// Take away the newest flag (checkpoints disappear in reverse order).
function removeCheckpoint() {
  if (checkpoints.length === 0) return;
  checkpoints.pop();
  sfx.pad();
}
// Come back to life at the newest flag instead of the start.
function restoreCheckpoint() {
  const cp = checkpoints[checkpoints.length - 1];
  player = { x: cp.x, y: cp.y, vy: cp.vy, rot: cp.rot,
             onGround: cp.onGround, dead: false, won: false };
  camX = cp.camX;
  coinsGot = new Set(cp.coins);
  speedMult = (cp.speedMult != null) ? cp.speedMult : 1;   // restore the speed too
  gravityDir = (cp.gravityDir != null) ? cp.gravityDir : 1; // and the gravity direction
  flying = (cp.flying != null) ? cp.flying : false;         // and rocket-or-cube
  bridgeFades = {};                    // bridges come back solid on a respawn
  particles = []; trail = []; shake = 0; winT = 0; deadT = 0;
  runPercent = 0; runWasBest = false;
}

// ---------------- Checkpoints (the  @  tiles) ----------------
// Touching a  @  saves your spot — that snapshot happens in js/game/physics.js.
// Coming BACK to life at it is game flow (music, the on-screen tag), so it
// lives here.
// Come back to life at the checkpoint. Still counts as a new attempt, and the
// music keeps playing (it only restarts on a full restart or a new level).
function restoreTileCheckpoint() {
  const cp = tileCheckpoint;
  attempts++;
  document.getElementById("attempts").textContent = "Attempt " + attempts;
  player = { x: cp.x, y: cp.y, vy: cp.vy, rot: cp.rot,
             onGround: cp.onGround, onRamp: 0, dead: false, won: false };
  camX = cp.camX;
  coinsGot = new Set(cp.coins);
  speedMult = cp.speedMult;            // back to the speed you had at the checkpoint
  gravityDir = cp.gravityDir;          // and the gravity direction you had
  flying = cp.flying;                  // dying inside a flight section puts you back in a rocket
  bridgeFades = {};                    // bridges come back solid on a respawn
  squash = 0;
  particles = []; trail = []; shake = 0; winT = 0; deadT = 0;
  runPercent = 0; runWasBest = false;
  checkpointTagT = 2;                  // show "from checkpoint" for 2 seconds
}



// ---------------- Physics ----------------
// The simulation itself lives in js/game/physics.js (pure: state in, state
// out). This section wires it to the game: the shared `simState`, the game
// loop, and turning the physics' little notes into sounds and splashes.
let accumulator = 0, lastTime = 0;

// The physics module only ever touches this one `state` object. We build it
// here as a LIVE VIEW of the game's own variables — reading or writing a field
// on simState reads or writes the real variable — so the physics and the rest
// of the game always agree, with no copying back and forth.
const simState = {
  get player() { return player; }, set player(v) { player = v; },
  get camX() { return camX; }, set camX(v) { camX = v; },
  get speedMult() { return speedMult; }, set speedMult(v) { speedMult = v; },
  get gravityDir() { return gravityDir; }, set gravityDir(v) { gravityDir = v; },
  get flying() { return flying; }, set flying(v) { flying = v; },
  get holding() { return holding; },
  get coinsGot() { return coinsGot; },
  get trail() { return trail; },
  get bridgeFades() { return bridgeFades; },
  get level() { return S.level; },
  get tileCheckpoint() { return tileCheckpoint; }, set tileCheckpoint(v) { tileCheckpoint = v; },
  get activatedCheckpoints() { return activatedCheckpoints; },
  events: [],
};

// render.js (draw) needs to see a lot of the game at once. Like simState, this
// is a LIVE VIEW of the game's own variables: draw() reads most of them, writes
// the win/death timers, and asks for a respawn — all straight through here.
const gameView = {
  get ctx() { return ctx; }, get W() { return W; }, get H() { return H; },
  get camX() { return camX; }, get player() { return player; }, get gravityDir() { return gravityDir; },
  get coinsGot() { return coinsGot; }, get trail() { return trail; }, get particles() { return particles; },
  get checkpoints() { return checkpoints; }, get activatedCheckpoints() { return activatedCheckpoints; },
  get bridgeFades() { return bridgeFades; },
  get totalCoins() { return totalCoins; }, get attempts() { return attempts; },
  get runPercent() { return runPercent; }, get runWasBest() { return runWasBest; },
  get playerName() { return playerName; },
  get tileCheckpoint() { return tileCheckpoint; },
  get S() { return S; },
  get shake() { return shake; }, set shake(v) { shake = v; },
  get beatPulse() { return beatPulse; }, set beatPulse(v) { beatPulse = v; },
  get squash() { return squash; }, set squash(v) { squash = v; },
  get winT() { return winT; }, set winT(v) { winT = v; },
  get deadT() { return deadT; }, set deadT(v) { deadT = v; },
  get checkpointTagT() { return checkpointTagT; }, set checkpointTagT(v) { checkpointTagT = v; },
  activeSkin, levelProgress, myBest, leaderboardFor,
  restoreCheckpoint, restoreTileCheckpoint, resetRun,
};

// The physics never makes noise itself — it just leaves notes in
// simState.events (a coin grabbed, a pad hit, a death, a win). We act on those
// notes here, in the game, once per frame: play the sound, shake the screen,
// explode the cube, save the score.
function drainSimEvents() {
  for (const ev of simState.events) {
    if (ev === "pad") sfx.pad();
    else if (ev === "catapult") { sfx.catapult(); squash = 1; }
    else if (ev === "coin") sfx.coin();
    else if (ev === "die") {
      deadT = 0; shake = CONFIG.SCREEN_SHAKE; sfx.death();
      runPercent = Math.round(levelProgress() * 100);   // how far you got, for the high score
      submitScore(runPercent);
      spawnExplosion(player.x, player.y, activeSkin(), particles);
    } else if (ev === "win") {
      winT = 0; sfx.win();
      runPercent = 100;                                 // reaching the finish is 100%
      submitScore(runPercent);
    }
  }
  simState.events.length = 0;
}


function jump() {
  if (S.screen !== "game" || S.paused) return;
  if (requestJump(simState)) sfx.jump();   // physics does the jump; we make the sound
}

// How far through the level the cube is right now, 0 (start) to 1 (finish).
// The cube only ever moves right, so this is also the furthest it has reached.
function levelProgress() {
  if (!S.level || !player) return 0;
  return Math.max(0, Math.min(1, (player.x / CONFIG.TILE) / S.level.cols));
}


// ---------------- Rendering ----------------

// Which skin should the cube wear right now? If a player is chosen, we use
// their saved skin. If nobody is chosen, we build the classic cube from the
// Control Panel colors, so "Save for everyone" color tweaks still work and the
// default look is exactly the same as it always was.
function activeSkin() {
  if (currentProfile && currentProfile.skin) return normalizeSkin(currentProfile.skin);
  return normalizeSkin({ bodyColor: CONFIG.PLAYER_COLOR, faceColor: CONFIG.PLAYER_EYE_COLOR });
}




// ---------------- Main loop ----------------
function frame(t) {
  requestAnimationFrame(frame);
  if (!lastTime) lastTime = t;
  let dt = (t - lastTime) / 1000; lastTime = t;
  if (dt > 0.25) dt = 0.25;                 // tab was hidden; don't teleport
  // Physics only runs while playing AND the control panel is closed.
  if (S.screen === "game" && !S.paused) {
    accumulator += dt;
    while (accumulator >= FIXED_DT) { stepPhysics(simState, FIXED_DT); accumulator -= FIXED_DT; }
    drainSimEvents();
  } else {
    accumulator = 0;                        // don't pile up time while paused
  }
  draw(gameView, dt);
}
requestAnimationFrame(frame);

// ---------------- Input ----------------
// All the tapping and key-pressing lives in js/input.js. We hand it the
// handful of things it needs to call, so it never has to know how the
// game works inside.
initInput({
  S,
  getPlayer: () => player,
  jump, afterWin, leaveGame,
  setHolding: (v) => { holding = v; },   // so the physics knows when to fire the rocket
  dropCheckpoint, removeCheckpoint,
  openPanel, closePanel, isPanelOpen,
});

// Leave a level and go back where you came from: the editor if you were
// play-testing, otherwise the main menu. Used by the Menu button, Escape,
// and by tapping after you win.
function leaveGame() {
  closePanel();
  Music.stop();                 // silence the music when we leave the level
  S.campaign = false;           // leaving always ends "Play All" mode
  document.getElementById("hud").classList.add("hidden");
  document.getElementById("attempts").classList.add("hidden");
  document.getElementById("topLeftBtns").classList.add("hidden");
  document.getElementById("practiceBtns").classList.add("hidden");
  if (S.testMode) { S.screen = "editor"; showScreen("editorScreen"); }
  else { S.screen = "menu"; showScreen("menuScreen"); }
}
function afterWin() {
  // In "Play All" mode, winning jumps straight to the next level. When you
  // finish the last one, cheer and go back to the menu.
  if (S.campaign && !S.testMode) {
    S.campaignIndex++;
    if (S.campaignIndex < serverLevels.length) { startLevelByIndex(S.campaignIndex); return; }
    showToast("You beat them all! 🎉");
  }
  leaveGame();
}

// Play the level at position `i` in the menu list (used by "Play All").
function startLevelByIndex(i) {
  const L = serverLevels[i];
  if (!L) { leaveGame(); return; }
  startLevel(parseLevel(L.level), false, isPracticeOn(), songForLevel(L, i), L.theme || 0, L.id);
}

// "Play All": start at the first level and roll through them all in order.
function startCampaign() {
  if (!serverLevels.length) { showToast("No levels yet — make one first!"); return; }
  S.campaign = true;
  S.campaignIndex = 0;
  startLevelByIndex(0);
}

// ---------------- Screens ----------------
function showScreen(id) {
  for (const s of ["menuScreen", "editorScreen", "skinScreen"]) document.getElementById(s).classList.toggle("hidden", s !== id);
  if (id !== null) {
    document.getElementById("hud").classList.add("hidden");
    document.getElementById("attempts").classList.add("hidden");
  }
}

/* ================================================================
   ================  TALKING TO THE SERVER  ========================
   ================================================================
   The game downloads its levels and shared settings from the little
   server (server.js) when it starts. Everything the game asks for
   goes through these helpers. */

// The levels we downloaded from the server (the editor's Edit buttons use this).
let serverLevels = [];

// Everyone's high scores (each player's best % on each level). Downloaded at
// start and kept fresh as new scores come in.
let serverScores = [];

// Copy the server's saved settings ON TOP OF our CONFIG defaults, so a
// change saved "for everyone" shows up for every player. DEFAULTS was
// captured earlier, so "Reset to defaults" still brings back the code numbers.
function applySettings(overrides) {
  for (const [key, value] of Object.entries(overrides || {})) {
    if (key in CONFIG) CONFIG[key] = value;
  }
  // The music speed lives inside music.js, so hand it the shared value.
  if (typeof Music !== "undefined") Music.setBpm(CONFIG.MUSIC_BPM);
}

// Who is playing on THIS tablet. Unlike the family PIN, the player's name is
// remembered on the device (in localStorage) so each kid's tablet knows them —
// it fills in "Made by" in the editor and labels their high scores. It's the one
// small per-device thing we keep (see CLAUDE.md rule 4).
let playerName = "";
try { playerName = localStorage.getItem("hh_player") || ""; } catch (e) { playerName = ""; }
function setPlayerName(name) {
  playerName = (name || "").trim().slice(0, 40);
  try { localStorage.setItem("hh_player", playerName); } catch (e) {}
  updateNameBtn();
}

/* ================================================================
   ==================  HIGH SCORES (best % per level)  ============
   ================================================================ */

// All of a level's scores, best first.
function leaderboardFor(levelId) {
  return serverScores
    .filter(s => Number(s.levelId) === Number(levelId))
    .sort((a, b) => b.percent - a.percent);
}
// This tablet's own best % on a level, or null if they've never played it.
function myBest(levelId) {
  if (!playerName) return null;
  const mine = serverScores.find(s => Number(s.levelId) === Number(levelId) && s.player === playerName);
  return mine ? mine.percent : null;
}
// Send how far the player got, but only when it's a real level, we know who is
// playing, AND it beats their old best (so we don't spam the server on every
// death). No family PIN needed — playing should never ask for the PIN.
async function submitScore(percent) {
  runWasBest = false;
  if (S.levelId == null || !playerName) return;
  const old = myBest(S.levelId);
  if (old != null && percent <= old) return;     // not an improvement — skip
  runWasBest = true;
  try {
    // A plain POST with NO family PIN — saving a score is open on purpose.
    const board = await apiPost("/scores", { levelId: S.levelId, player: playerName, percent });
    // That's this level's fresh leaderboard. Fold it back into our copy so
    // menus/overlays show the new numbers.
    serverScores = serverScores.filter(s => Number(s.levelId) !== Number(S.levelId)).concat(board);
    if (S.screen === "menu") buildMenu(serverLevels);
  } catch (e) { /* a lost score is no big deal — just keep playing */ }
}

// menu buttons
const list = document.getElementById("levelList");
function buildMenu(levels) {
  list.innerHTML = "";
  if (!levels.length) {
    list.innerHTML = '<div style="color:#fff;font-weight:bold">No levels yet — tap the Level Editor to make one!</div>';
    return;
  }
  levels.forEach((L, i) => {
    const item = document.createElement("div");
    item.className = "levelItem";
    // The big green button plays the level. Its second line shows the top
    // score and your own best, so kids can see what to beat.
    const play = document.createElement("button");
    play.className = "btn green";
    const title = (i + 1) + ". " + L.name + (L.author ? "  — " + L.author : "");
    play.innerHTML = '<div>' + escapeHtml(title) + '</div>' +
      '<div class="levelScore">' + scoreLine(L.id) + '</div>';
    play.onclick = () => { S.campaign = false; startLevel(parseLevel(L.level), false, isPracticeOn(), songForLevel(L, i), L.theme || 0, L.id); };
    // ...a little 📊 opens the full leaderboard for this level...
    const board = document.createElement("button");
    board.className = "btn small"; board.textContent = "📊"; board.title = "High scores";
    board.onclick = () => openScores(L);
    // ...the up/down buttons move it earlier or later in the list...
    const up = document.createElement("button");
    up.className = "btn small"; up.textContent = "▲"; up.title = "Move up";
    up.disabled = (i === 0);
    up.onclick = () => moveLevel(i, -1);
    const down = document.createElement("button");
    down.className = "btn small"; down.textContent = "▼"; down.title = "Move down";
    down.disabled = (i === levels.length - 1);
    down.onclick = () => moveLevel(i, +1);
    // ...the pencil opens it in the editor to change it...
    const edit = document.createElement("button");
    edit.className = "btn small"; edit.textContent = "✎"; edit.title = "Edit";
    edit.onclick = () => openLevelForEdit(L);
    // ...and the trash can deletes it (after an "are you sure?").
    const del = document.createElement("button");
    del.className = "btn small pink"; del.textContent = "🗑"; del.title = "Delete";
    del.onclick = () => deleteLevel(L);
    item.append(play, board, up, down, edit, del);
    list.appendChild(item);
  });
}

// The little grey line under a level's name: the top score and your own best.
function scoreLine(levelId) {
  const top = leaderboardFor(levelId)[0];
  if (!top) return "No scores yet — be the first!";
  let line = "🏆 " + top.percent + "% " + escapeHtml(top.player);
  const mine = myBest(levelId);
  if (mine != null) line += "   ·   you " + mine + "%";
  return line;
}

// Keep names safe to drop straight into the button's HTML.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ================================================================
   ==================  WHO'S PLAYING (the name)  =================
   ================================================================ */

// When the player changes, freshen the "Who's playing?" row.
function updateNameBtn() { buildProfilePicker(); }

// The name pop-up, now a promise: ask for a name and wait. Resolves to the typed
// name, or null if they tapped Cancel. Reused for "New player" and first run.
function askName(prefill) {
  return new Promise(resolve => {
    const box = document.getElementById("nameBox");
    const input = document.getElementById("nameInput");
    const okBtn = document.getElementById("nameOkBtn");
    const cancelBtn = document.getElementById("nameCancelBtn");
    input.maxLength = 20;               // player names are 1–20 letters
    input.value = prefill || "";
    box.classList.remove("hidden");
    setTimeout(() => input.focus(), 50);
    function done(val) {
      box.classList.add("hidden");
      okBtn.onclick = cancelBtn.onclick = input.onkeydown = null;
      resolve(val);
    }
    okBtn.onclick = () => {
      const name = input.value.trim();
      if (!name) { showToast("Please type a name."); return; }
      done(name);
    };
    cancelBtn.onclick = () => done(null);
    input.onkeydown = e => { if (e.key === "Enter") okBtn.onclick(); };
  });
}

// Draw a player's cube onto a little square canvas, for the menu buttons.
function renderProfileCube(canvas, skin) {
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, canvas.width, canvas.height);
  drawPlayer(c, canvas.width / 2, canvas.height / 2, 0, skin, canvas.width * 0.62);
}

// Build the "Who's playing?" row on the menu: one cube button per saved player,
// the current player highlighted, plus "Edit my cube" and "New player".
function buildProfilePicker() {
  const row = document.getElementById("profileRow");
  if (!row) return;
  row.innerHTML = "";

  // The list of players to show. If this tablet has a name but no saved player
  // yet (a fresh upgrade), show that name as a starter cube so the kid sees
  // themselves right away; it becomes a real saved player when they first Save.
  const shown = profiles.slice();
  if (currentProfile && currentProfile.id == null &&
      !shown.some(p => p.name === currentProfile.name)) {
    shown.unshift(currentProfile);
  }

  for (const p of shown) {
    const isCurrent = currentProfile &&
      (p.id != null ? currentProfile.id === p.id : currentProfile === p);
    const btn = document.createElement("button");
    btn.className = "profileBtn" + (isCurrent ? " selected" : "");
    const cv = document.createElement("canvas");
    cv.width = 56; cv.height = 56;
    btn.appendChild(cv);
    renderProfileCube(cv, p.skin);
    const nm = document.createElement("div");
    nm.className = "pName"; nm.textContent = p.name;
    btn.appendChild(nm);
    btn.onclick = () => chooseProfile(p);
    row.appendChild(btn);
  }

  // If a real (saved) player is chosen, offer to edit their cube.
  if (currentProfile) {
    const edit = document.createElement("button");
    edit.className = "profileBtn add";
    edit.innerHTML = "✎<div class='pName'>Edit my cube</div>";
    edit.onclick = () => openSkinEditor(currentProfile);
    row.appendChild(edit);
  }

  // Always offer to add a brand-new player.
  const add = document.createElement("button");
  add.className = "profileBtn add";
  add.innerHTML = "＋<div class='pName'>New player</div>";
  add.onclick = () => newProfile();
  row.appendChild(add);
}

// Pick who's playing. This also becomes the name on your high scores and the
// "Made by" on levels, so the cube you see and the name on the board match.
function chooseProfile(p) {
  currentProfile = p;
  setPlayerName(p.name);       // setPlayerName calls updateNameBtn → rebuilds the row
  buildMenu(serverLevels);     // your best scores show up in the level list
}

// Make a new player: ask for a name, then open the cube editor on a fresh cube.
// Nothing is saved to the server until they tap Save (that's when the PIN asks).
async function newProfile() {
  const name = await askName("");
  if (!name) return;
  openSkinEditor({ id: null, name, skin: { ...DEFAULT_SKIN } });
}

/* ================================================================
   ==================  THE CUBE (SKIN) EDITOR  ===================
   ================================================================
   Lives in js/ui/skins.js. It needs to know where we are (S), how to
   change page, which way gravity points (for the preview's explosion),
   and what to do once a cube has been saved. */
initSkins({
  S,
  showScreen,
  getGravityDir: () => gravityDir,
  onSaved: async (saved) => {
    profiles = await apiGet("/profiles");
    currentProfile = profiles.find(p => p.id === saved.id) || saved;
    setPlayerName(currentProfile.name);
    S.screen = "menu"; showScreen("menuScreen");
    buildMenu(serverLevels);
  },
});

/* ================================================================
   =====================  THE 📊 LEADERBOARD  =====================
   ================================================================ */

// Show every player's best on one level, best first.
function openScores(L) {
  document.getElementById("scoresTitle").textContent = "🏆 " + L.name;
  const listEl = document.getElementById("scoresList");
  const board = leaderboardFor(L.id);
  if (!board.length) {
    listEl.innerHTML = '<div class="scoreRow">No scores yet — go play it!</div>';
  } else {
    listEl.innerHTML = board.map((s, i) => {
      const mine = (s.player === playerName) ? " you" : "";
      return '<div class="scoreRow' + (mine ? " me" : "") + '">' +
        '<span>' + (i + 1) + ". " + escapeHtml(s.player) + '</span>' +
        '<span>' + s.percent + '%</span></div>';
    }).join("");
  }
  document.getElementById("scoresBox").classList.remove("hidden");
}
document.getElementById("scoresCloseBtn").onclick = () => document.getElementById("scoresBox").classList.add("hidden");

// Is the "Practice mode" box ticked?
function isPracticeOn() { return document.getElementById("practiceChk").checked; }

// Each level plays its own tune: the level's `song`, or the next one in the list.
function songForLevel(L, i) {
  return (L.song !== undefined && L.song !== null) ? L.song : (i % SONGS.length);
}

// Move the level at position `index` up (-1) or down (+1) and save the new
// order to the server so everyone sees it.
async function moveLevel(index, dir) {
  const j = index + dir;
  if (j < 0 || j >= serverLevels.length) return;
  const order = serverLevels.map(L => L.id);
  [order[index], order[j]] = [order[j], order[index]];   // swap the two ids
  try {
    await apiWrite("PUT", "/levels/order", { order });
    serverLevels = await apiGet("/levels");
    buildMenu(serverLevels);
  } catch (e) { if (e.message !== "cancelled") showToast(e.message); }
}

// Ask "are you sure?" then delete the level from the server.
async function deleteLevel(L) {
  const ok = await askConfirm("Delete \"" + L.name + "\"? This can't be undone here.");
  if (!ok) return;
  try {
    await apiWrite("DELETE", "/levels/" + L.id);
    serverLevels = await apiGet("/levels");
    buildMenu(serverLevels);
    showToast("Deleted.");
  } catch (e) { if (e.message !== "cancelled") showToast(e.message); }
}

// Open one of the server's levels in the editor so it can be changed and
// saved back in place (instead of making a brand-new copy).

// Show a friendly note on the menu (used when the server can't be reached).
function menuMessage(msg) {
  list.innerHTML = '<div style="color:#fff;font-weight:bold;max-width:80vw;text-align:center">' + msg + '</div>';
}

document.getElementById("playAllBtn").onclick = startCampaign;

document.getElementById("openEditorBtn").onclick = openNewLevel;

/* ================================================================
   ========================  CONTROL PANEL  ========================
   ================================================================
   The sliders and switches live in js/ui/settings.js. It needs to know
   whether we're playing (so it can pause) and which song is on, so we
   hand it S. openPanel/closePanel/isPanelOpen come back from there. */
initSettings({ S });

/* ================================================================
   ========================  LEVEL EDITOR  =========================
   ================================================================
   Lives in js/ui/editor.js. It needs to know where we are (S), how to
   change page, how to start a test play, who's playing (the author),
   and what to do after a save. */
initEditor({
  S,
  showScreen,
  startLevel,
  getPlayerName: () => playerName,
  onSaved: async () => {
    serverLevels = await apiGet("/levels");   // keep our copy fresh for the menu
    buildMenu(serverLevels);
  },
});

/* ================================================================
   ========================  START UP  =============================
   ================================================================
   When the page loads we download the shared settings and the list of
   levels from the server, then build the menu. If the server can't be
   reached we say so instead of showing a blank screen. */
async function init() {
  // Load the players (their cubes) on their own, so an older server without the
  // profiles endpoint just shows "New player" instead of a broken menu.
  try { profiles = await apiGet("/profiles"); } catch (e) { profiles = []; }
  // Auto-pick who's playing: the saved player whose name matches this tablet's,
  // or — if this tablet has a name but no saved player yet — show that name as a
  // starter cube (it becomes a real saved player the first time they Save).
  currentProfile = profiles.find(p => p.name === playerName)
    || (playerName ? { id: null, name: playerName, skin: { ...DEFAULT_SKIN } } : null);
  buildProfilePicker();

  try {
    const [settings, levels, scores] = await Promise.all([
      apiGet("/settings"),
      apiGet("/levels"),
      apiGet("/scores"),
    ]);
    applySettings(settings);       // shared "Save for everyone" numbers
    serverLevels = levels;
    serverScores = scores;
    buildMenu(levels);
  } catch (e) {
    console.error(e);
    menuMessage("Can't reach the game server. Make sure it's running, then reload.");
  }
  // First time on this tablet (no name, no players)? Gently ask for a new player.
  if (!playerName && !profiles.length) newProfile();
}
init();
