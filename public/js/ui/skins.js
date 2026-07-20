// ============================================================
// skins.js — the cube (skin) editor.
// ============================================================
// Another page, just like the level editor. You pick colors, a shape,
// a face, a trail, and an explosion, and watch a little cube run and
// jump with your choices right away. "Save" stores it on the server.
//
// Skins are LOOKS ONLY — nothing here changes how the game plays.

import { CONFIG, DEFAULT_SKIN, SHAPES, FACES, TRAIL_STYLES, EXPLOSION_STYLES,
         SKIN_BODY_COLORS, SKIN_OUTLINE_COLORS, SKIN_FACE_COLORS } from "../config.js";
import { hslToHex, normalizeSkin, drawPlayer } from "../game/player.js";
import { drawTrail, spawnExplosion, renderParticles } from "../game/effects.js";
import { apiWrite } from "../api.js";
import { showToast } from "./toast.js";

// The bits of the game this page needs. main.js fills them in with initSkins().
let S = null;
let showScreen = () => {};
let getGravityDir = () => 1;
let onSaved = async () => {};

export function initSkins(deps) {
  S = deps.S;
  showScreen = deps.showScreen;
  getGravityDir = deps.getGravityDir;
  onSaved = deps.onSaved;
}

// The cube we are editing right now. SK.skin is changed in place as you tap, so
// the live preview (which reads SK.skin) shows every change on the next frame.
const SK = { id: null, name: "", skin: { ...DEFAULT_SKIN } };

// Open the cube editor for a player (real, or a brand-new {id:null,...} one).
export function openSkinEditor(profile) {
  SK.id = profile.id != null ? profile.id : null;
  SK.name = profile.name || "";
  SK.skin = normalizeSkin(profile.skin);
  document.getElementById("skinTitle").textContent = SK.name ? (SK.name + "'s Cube") : "My Cube";
  buildSkinEditor();
  S.screen = "skin";
  showScreen("skinScreen");
  startSkinPreview();
}

// Build one row of color swatches + a rainbow slider for one skin color.
function colorRow(label, key, swatches) {
  const row = document.createElement("div");
  row.className = "skinRow";
  row.innerHTML = "<span class='lbl'>" + label + "</span>";
  const marks = [];                      // remember the swatch buttons so we can un-highlight
  for (const hex of swatches) {
    const sw = document.createElement("button");
    sw.className = "swatch" + (SK.skin[key] === hex ? " selected" : "");
    sw.style.background = hex;
    sw.onclick = () => {
      SK.skin[key] = hex;
      marks.forEach(m => m.classList.remove("selected"));
      sw.classList.add("selected");
    };
    marks.push(sw);
    row.appendChild(sw);
  }
  // The rainbow slider makes any color you like. Using it clears the swatch pick.
  const slider = document.createElement("input");
  slider.type = "range"; slider.min = "0"; slider.max = "360"; slider.className = "hueSlider";
  slider.oninput = () => {
    SK.skin[key] = hslToHex(Number(slider.value));
    marks.forEach(m => m.classList.remove("selected"));
  };
  row.appendChild(slider);
  return row;
}

// Build one row of tappable option buttons (shape, face, trail, explosion).
function optionRow(label, key, options, labels, onChange) {
  const row = document.createElement("div");
  row.className = "skinRow";
  row.innerHTML = "<span class='lbl'>" + label + "</span>";
  const marks = [];
  options.forEach((opt, i) => {
    const b = document.createElement("button");
    b.className = "optBtn" + (SK.skin[key] === opt ? " selected" : "");
    b.textContent = labels ? labels[i] : opt;
    b.onclick = () => {
      SK.skin[key] = opt;
      marks.forEach(m => m.classList.remove("selected"));
      b.classList.add("selected");
      if (onChange) onChange();
    };
    marks.push(b);
    row.appendChild(b);
  });
  return row;
}

// Build the whole set of choices under the preview.
function buildSkinEditor() {
  const wrap = document.getElementById("skinControls");
  wrap.innerHTML = "";
  wrap.appendChild(colorRow("Body", "bodyColor", SKIN_BODY_COLORS));
  wrap.appendChild(colorRow("Outline", "outlineColor", SKIN_OUTLINE_COLORS));
  wrap.appendChild(colorRow("Face", "faceColor", SKIN_FACE_COLORS));
  wrap.appendChild(optionRow("Shape", "shape", SHAPES,
    ["■ Square", "▢ Rounded", "● Circle", "◆ Diamond", "⬡ Hex"]));

  // The face row. Choosing "emoji" shows a little box to type one emoji.
  const emojiRow = document.createElement("div");
  emojiRow.className = "skinRow";
  emojiRow.style.display = SK.skin.face === "emoji" ? "flex" : "none";
  emojiRow.innerHTML = "<span class='lbl'>Emoji</span>";
  const emojiInput = document.createElement("input");
  emojiInput.className = "modalInput"; emojiInput.style.maxWidth = "90px";
  emojiInput.maxLength = 8; emojiInput.value = SK.skin.emoji;
  emojiInput.oninput = () => {
    const v = emojiInput.value.trim();
    if (v) SK.skin.emoji = normalizeSkin({ emoji: v }).emoji;
  };
  emojiRow.appendChild(emojiInput);

  wrap.appendChild(optionRow("Face", "face", FACES,
    ["None", "Happy", "Cool", "Angry", "Silly", "Sleepy", "Robot", "Emoji"],
    () => { emojiRow.style.display = SK.skin.face === "emoji" ? "flex" : "none"; }));
  wrap.appendChild(emojiRow);

  wrap.appendChild(optionRow("Trail", "trail", TRAIL_STYLES,
    ["Off", "Fade", "Rainbow", "Bubbles"]));
  wrap.appendChild(optionRow("Boom", "explosion", EXPLOSION_STYLES,
    ["Squares", "Stars", "Confetti", "Emoji"]));
}

// ---- The live preview: a tiny cube running and jumping on a loop ----
// It uses the SAME drawPlayer / drawTrail / renderParticles as the real game,
// but with its own little world, so it never touches the real level.
const PV = { x: 60, y: 0, vy: 0, rot: 0, onGround: true, dead: false, since: 0,
             trail: [], particles: [], last: 0, lastTrail: 0 };

function startSkinPreview() {
  PV.x = 60; PV.y = 0; PV.vy = 0; PV.rot = 0; PV.onGround = true; PV.dead = false;
  PV.trail = []; PV.particles = []; PV.last = 0; PV.since = 0;
  requestAnimationFrame(skinPreviewFrame);
}

function previewJump() {
  if (PV.onGround && !PV.dead) { PV.vy = -CONFIG.JUMP_POWER * 0.55; PV.onGround = false; }
}

function skinPreviewFrame(ts) {
  if (S.screen !== "skin") return;        // left the page — stop the loop
  requestAnimationFrame(skinPreviewFrame);
  const cv = document.getElementById("skinPreview");
  const c = cv.getContext("2d");
  const dt = PV.last ? Math.min(0.05, (ts - PV.last) / 1000) : 0;
  PV.last = ts;

  const groundY = cv.height * 0.72;
  const id = v => v;                       // preview draws in plain canvas pixels

  if (!PV.dead) {
    PV.vy += CONFIG.GRAVITY * dt; PV.y += PV.vy * dt; PV.since += dt;
    if (PV.y >= groundY) {                 // landed
      PV.y = groundY; PV.vy = 0; PV.onGround = true;
      PV.rot = Math.round(PV.rot / 90) * 90;
    } else {
      PV.rot += CONFIG.SPIN_SPEED * dt;    // spin in the air
    }
    if (PV.onGround && PV.since > 1.2) { previewJump(); PV.since = 0; }
    // feed the trail, the same way the game does
    if (ts - PV.lastTrail > 40) {
      PV.trail.push({ x: PV.x, y: PV.y, life: 1 });
      if (PV.trail.length > 40) PV.trail.shift();
      PV.lastTrail = ts;
    }
  }

  // background + ground line
  c.clearRect(0, 0, cv.width, cv.height);
  c.fillStyle = "#14142c"; c.fillRect(0, 0, cv.width, cv.height);
  c.fillStyle = "rgba(255,255,255,.5)";
  c.fillRect(0, groundY + CONFIG.PLAYER_SIZE / 2, cv.width, 2);

  const skin = normalizeSkin(SK.skin);
  drawTrail(c, id, id, skin, dt, PV.trail, PV.dead);
  if (!PV.dead) drawPlayer(c, PV.x, PV.y, PV.rot, skin);
  renderParticles(c, id, id, dt, PV.particles, getGravityDir());
}

// The "Try it out" button: blow the cube up so you can see the explosion, then
// put it back together after a moment.
function previewDeath() {
  if (PV.dead) return;
  PV.dead = true;
  spawnExplosion(PV.x, PV.y, normalizeSkin(SK.skin), PV.particles);
  setTimeout(() => {
    PV.dead = false; PV.y = 0; PV.vy = 0; PV.onGround = false; PV.trail = []; PV.since = 0;
  }, 1100);
}

// Save the cube to the server (creating a new player, or updating one). Same
// PIN flow as saving a level.
async function saveSkin() {
  const body = { name: SK.name, skin: normalizeSkin(SK.skin) };
  try {
    let saved;
    if (SK.id != null) saved = await apiWrite("PUT", "/profiles/" + SK.id, body);
    else saved = await apiWrite("POST", "/profiles", body);
    showToast("Saved!");
    await onSaved(saved);   // main.js refreshes the players and goes back to the menu
  } catch (e) { if (e.message !== "cancelled") showToast(e.message); }
}

document.getElementById("skinSaveBtn").onclick = saveSkin;
document.getElementById("skinBackBtn").onclick = () => { S.screen = "menu"; showScreen("menuScreen"); };
document.getElementById("skinDeathBtn").onclick = previewDeath;
document.getElementById("skinPreview").addEventListener("pointerdown", e => { e.stopPropagation(); previewJump(); });
