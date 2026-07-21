// ============================================================
// config.js — the game's control panel + cube-skin choices.
// ============================================================
// This is the single place to change how the game feels: gravity,
// jump height, colors, sound, and so on. Every number here is safe
// to play with. It's all plain data (no game code), so the physics,
// the drawing, and the editor can all import from here.

/* ================================================================
   ============  CHANGE THESE NUMBERS AND SEE WHAT HAPPENS!  =======
   ================================================================
   This is the control panel for the whole game. Every number here
   is safe to change. Make gravity weird. Make the cube huge.
   Refresh the page after saving to see your changes.
   ================================================================ */

export const CONFIG = {

  // ---------- HOW THE CUBE MOVES ----------
  SCROLL_SPEED: 360,      // how fast the world flies by (pixels per second). Try 200 (easy) or 500 (crazy)
  GRAVITY: 5000,          // how hard the cube falls. Moon = 1500, Earth = 5000, Jupiter = 12000
  JUMP_POWER: 950,        // how strong a jump is. Bigger number = higher jump
  PAD_POWER: 1350,        // how strong the yellow bounce pads are
  SMALL_PAD_POWER: 850,   // how strong the little pink pads ( p ) are — a gentler hop
  CATAPULT_POWER: 2000,   // how strong a catapult ( U ) flings you — a giant launch!
  SPIN_SPEED: 480,        // how fast the cube spins in the air (degrees per second)

  // ---------- WHERE THE CAMERA LOOKS ----------
  CAMERA_X: 0.33,         // where the cube sits across the screen.
                          // 0 = squashed against the left edge, 0.5 = right in the middle.
                          // Smaller = you see further ahead; bigger = more room behind you

  // ---------- RAMPS (the slopes  /  and  \  ) ----------
  RAMP_LAUNCH: 0.6,       // running off the top of a  /  ramp pops you up. Bigger = higher pop. 0 = no pop
  RAMP_GLUE: 12,          // how hard a  \  ramp "sticks" you to the slope so you don't bounce (pixels). 0 = no stick

  // ---------- PLATFORMS & BRIDGES ----------
  BRIDGE_FADE_TIME: 0.8,  // once you run past a  -  bridge tile, how long it takes to fade away (seconds)

  // ---------- PORTALS (the gates you run through) ----------
  FAST_MULT: 1.5,         // a  >  gate makes the world scroll this many times normal speed
  SLOW_MULT: 0.75,        // a  <  gate makes it this many times normal speed (less than 1 = slower)

  // ---------- FLYING (between an  f  gate and a  c  gate) ----------
  FLY_THRUST: 3200,       // how hard holding the button pushes you up while flying.
                          // Less than GRAVITY (5000) and you can never climb!
  FLY_MAX_SPEED: 600,     // the fastest you can climb or dive while flying (pixels per second)
  FLY_TILT: 30,           // how far the cube tips its nose while flying (degrees). 0 = always flat

  // ---------- SIZES ----------
  LEVEL_ROWS: 14,         // how many squares tall the sky is. 14 fills a tablet screen nicely.
                          // Bigger = more room to fly, but everything looks smaller
  TILE: 40,               // size of one grid square. Everything is built from these
  PLAYER_SIZE: 34,        // how big the cube is (should be a bit smaller than TILE)
  SPIKE_MERCY: 0.35,      // how forgiving spikes are (0 = brutal, 0.5 = very kind)
  SAW_RADIUS: 0.38,       // how big a saw blade ( s ) is, as a fraction of a tile (round deadly circle)

  // ---------- LOOKS ----------
  PLAYER_COLOR: "#7dff5e",     // the cube. Try "#ff5ec6" or "#ffe14d"
  PLAYER_EYE_COLOR: "#05051a", // the cube's face
  BLOCK_COLOR: "#3ec6ff",      // platforms and blocks
  BLOCK_EDGE: "#ffffff",       // outline on top of blocks
  SPIKE_COLOR: "#ff4d6d",      // the deadly triangles
  PAD_COLOR: "#ffe14d",        // bounce pads
  SMALL_PAD_COLOR: "#ff7ed4",  // the little pink pads ( p )
  CATAPULT_COLOR: "#ffd21a",   // the catapult bucket ( U )
  COIN_COLOR: "#ffd700",       // collectible coins
  GROUND_COLOR: "#222252",     // the floor
  SKY_TOP: "#1a0533",          // background gradient, top...
  SKY_BOTTOM: "#e6007e",       // ...and bottom. Try swapping them!

  // ---------- EFFECTS ----------
  PARTICLES_ON_DEATH: 24, // how many pieces the cube explodes into
  TRAIL: true,            // leave a glowing trail behind the cube? true or false
  SCREEN_SHAKE: 10,       // how much the screen shakes when you die (0 = off)

  // ---------- SOUND ----------
  SOUND: true,            // beeps and boops (jump, coin, death)? true or false
  MUSIC: true,            // background music from music.js? true or false
  MUSIC_VOLUME: 0.5,      // how loud the music is (0 = off, 1 = loud)
  MUSIC_BPM: 0,           // music speed. 0 = each song keeps its own speed; any other number forces that beat
  BEAT_PULSE: true,       // make the world flash gently on the beat? true or false

  // ---------- HIGH SCORES ----------
  LEADERBOARD_TOP: 5,     // how many players to show on the leaderboard (win screen + 📊 list)

  // ---------- COINS ----------
  // These are only about how coins LOOK. What things COST lives on the
  // server, in data/prices.json — so nobody can give themselves a
  // million coins by changing this file in their browser. 😉
  COIN_SILVER_COLOR: "#c0c8d8",  // a coin you already earned once: still fun to grab, but no new coins
  COIN_HUD_COLOR: "#ffd700",     // your purse, in the corner while you play
};

// A saved copy of the numbers above, so the "Reset to defaults"
// button in the Control Panel can put everything back the way it was.
export const DEFAULTS = { ...CONFIG };

// ---------- BACKGROUND THEMES ----------
// Each level can pick a theme for its background. "Default" (the first one)
// uses the colors from the Control Panel, so old levels look just the same.
// The others bring their own sky (top + bottom) and ground color.
// Pick a level's theme with the 🎨 button in the editor.
export const THEMES = [
  { name: "Default" },                                                    // use the Control Panel colors
  { name: "Sunset",  SKY_TOP: "#2a0845", SKY_BOTTOM: "#ff7e5f", GROUND: "#3a1c40" },
  { name: "Ocean",   SKY_TOP: "#001a33", SKY_BOTTOM: "#00c6ff", GROUND: "#02324d" },
  { name: "Space",   SKY_TOP: "#000010", SKY_BOTTOM: "#3a0ca3", GROUND: "#0d0d2b" },
  { name: "Candy",   SKY_TOP: "#ff9ff3", SKY_BOTTOM: "#feca57", GROUND: "#b33771" },
  { name: "Forest",  SKY_TOP: "#0b3d2e", SKY_BOTTOM: "#7bed9f", GROUND: "#123524" },
];

/* ================================================================
   ====================  CUBE SKINS  ==============================
   ================================================================
   A "skin" is how a player's cube LOOKS — its shape, colors, face,
   trail, and how it explodes. Skins are LOOKS ONLY: they never change
   how the game plays. The cube always bumps into things as a
   CONFIG.PLAYER_SIZE square, no matter what shape you draw (see the
   note in drawPlayer). Each player picks a skin in the cube editor;
   it is saved on the server with their name.

   These lists are the only allowed choices for each part. If a saved
   skin ever has a choice we don't know (say, from a newer game), we
   quietly use the default instead, so nothing ever breaks.
   ================================================================ */
export const SHAPES = ["square", "rounded", "circle", "diamond", "hex"];
export const FACES = ["none", "happy", "cool", "angry", "silly", "sleepy", "robot", "emoji"];
export const TRAIL_STYLES = ["off", "fade", "rainbow", "bubbles"];
export const EXPLOSION_STYLES = ["squares", "stars", "confetti", "emoji"];

// The plain green cube the game always had. Any missing part of a skin
// falls back to one of these, so the default look never changes.
export const DEFAULT_SKIN = {
  bodyColor: "#7dff5e",    // same green as CONFIG.PLAYER_COLOR starts as
  outlineColor: "#ffffff", // the white line around the cube
  faceColor: "#05051a",    // same dark as CONFIG.PLAYER_EYE_COLOR starts as
  shape: "square",
  face: "happy",
  emoji: "😀",             // only used when face (or explosion) is "emoji"
  trail: "fade",
  explosion: "squares",
};

// Curated color swatches for the cube editor — about ten friendly colors
// each. The current defaults are included so they show up as a swatch too.
export const SKIN_BODY_COLORS = [
  "#7dff5e", "#ff5ec6", "#ffe14d", "#3ec6ff", "#ff4d4d",
  "#a66bff", "#ff9f1c", "#00e5b0", "#ffffff", "#20242e",
];
export const SKIN_OUTLINE_COLORS = [
  "#ffffff", "#05051a", "#ffe14d", "#ff5ec6", "#3ec6ff",
  "#7dff5e", "#ff4d4d", "#a66bff", "#00e5b0", "#ff9f1c",
];
export const SKIN_FACE_COLORS = [
  "#05051a", "#ffffff", "#ff4d4d", "#3ec6ff", "#ffe14d",
  "#ff5ec6", "#7dff5e", "#a66bff", "#00e5b0", "#ff9f1c",
];
