// ============================================================
// skins.js — the cube (skin) editor.
// ============================================================
// Another page, just like the level editor. You pick colors, a shape,
// a face, a trail, and an explosion, and watch a little cube run and
// jump with your choices right away. "Save" stores it on the server.
//
// Underneath is MY LOOKS: every cube you have ever paid for, plus the
// ones levels have given you. Tap one to put it back on — that never
// costs anything, because you already own it.
//
// The page does one other job. The level editor borrows it to design
// the cube a LEVEL is played as (see openSkinEditor's `opts`): same
// controls, but nothing is bought and the answer goes back to the
// level instead of to your account.
//
// Skins are LOOKS ONLY — nothing here changes how the game plays.

import { CONFIG, DEFAULT_SKIN, SHAPES, FACES, TRAIL_STYLES, EXPLOSION_STYLES,
         SKIN_BODY_COLORS, SKIN_OUTLINE_COLORS, SKIN_FACE_COLORS } from "../config.js";
import { hslToHex, normalizeSkin, drawPlayer, sameSkin } from "../game/player.js";
import { drawTrail, spawnExplosion, renderParticles } from "../game/effects.js";
import { apiWrite } from "../api.js";
import { skinCost, balance, havePrices, myLooks } from "../economy.js";
import { showToast } from "./toast.js";

// The bits of the game this page needs. main.js fills them in with initSkins().
let S = null;
let showScreen = () => {};
let getGravityDir = () => 1;
let getMe = () => null;
let onSaved = async () => {};

export function initSkins(deps) {
  S = deps.S;
  showScreen = deps.showScreen;
  getGravityDir = deps.getGravityDir;
  getMe = deps.getMe || (() => null);
  onSaved = deps.onSaved;
}

// The cube we are editing right now. SK.skin is changed in place as you tap, so
// the live preview (which reads SK.skin) shows every change on the next frame.
// SK.savedSkin is a COPY of how the cube looked when we opened the editor —
// that's what we compare against to work out what you're buying. It has to be a
// copy: if it were the same object, it would change as you tap and everything
// would look free!
//
// SK.mode is which job the page is doing: "me" (your own cube, which you buy)
// or "level" (designing the cube a level is played as, which costs nothing).
const SK = {
  id: null, name: "", skin: { ...DEFAULT_SKIN }, savedSkin: { ...DEFAULT_SKIN },
  mode: "me",
  lookName: "",              // what a level's look is called ("The Crow")
  onDone: null, onCancel: null,   // where the answer goes, in "level" mode
};

const lookNameInput = document.getElementById("skinLookName");
const noLookBtn = document.getElementById("skinNoLookBtn");

// Open the cube editor for a player (real, or a brand-new {id:null,...} one).
//
// The level editor passes `opts` to borrow the page for a LEVEL's look:
//   { forLevel: true, name, skin, onDone(reward), onCancel() }
// where `reward` is {name, skin} — or null, meaning "this level has no look".
export function openSkinEditor(profile, opts) {
  const forLevel = !!(opts && opts.forLevel);
  SK.mode = forLevel ? "level" : "me";
  SK.id = profile && profile.id != null ? profile.id : null;
  SK.name = (profile && profile.name) || "";
  SK.skin = normalizeSkin(forLevel ? (opts.skin || profile && profile.skin) : profile.skin);
  SK.savedSkin = { ...SK.skin };          // a snapshot to price changes against
  SK.lookName = forLevel ? (opts.name || "") : "";
  SK.onDone = forLevel ? opts.onDone : null;
  SK.onCancel = forLevel ? opts.onCancel : null;

  document.getElementById("skinTitle").textContent = forLevel
    ? "The level's look"
    : (SK.name ? (SK.name + "'s Cube") : "My Cube");
  // The name box and the "no look" button belong to a level's look only.
  lookNameInput.value = SK.lookName;
  lookNameInput.classList.toggle("hidden", !forLevel);
  noLookBtn.classList.toggle("hidden", !forLevel);
  document.getElementById("skinBackBtn").textContent = forLevel ? "← Editor" : "← Menu";

  buildSkinEditor();
  buildLooksRow();
  updatePriceTag();
  S.screen = "skin";
  showScreen("skinScreen");
  startSkinPreview();
}

/* ================================================================
   ========================  MY LOOKS  ============================
   ================================================================
   A row of little cubes: everything you own. Tap one to wear it —
   it's free, because you already paid for it (or won it). A cube a
   level gave you wears a 🏅 so you can spot your prizes.

   There are no names here on purpose: a row of cubes says what it is
   far better than a row of words does, and the kids pick theirs out
   by sight anyway. */
const lookBtns = [];              // the buttons, so we can move the highlight about

function buildLooksRow() {
  const row = document.getElementById("looksRow");
  const wrap = document.getElementById("looksWrap");
  row.innerHTML = "";
  lookBtns.length = 0;
  const looks = myLooks();
  // Nothing to show until you own a second cube — one lonely square is
  // just clutter.
  wrap.classList.toggle("hidden", looks.length < 2);
  document.getElementById("looksHint").textContent = SK.mode === "level"
    ? "My Looks — tap one to build the level's look from it"
    : "My Looks — tap one to wear it again (free)";

  for (const look of looks) {
    const btn = document.createElement("button");
    btn.className = "lookBtn";
    const cv = document.createElement("canvas");
    cv.width = 48; cv.height = 48;
    btn.appendChild(cv);
    if (look.from === "level") {              // a prize from a level
      const badge = document.createElement("div");
      badge.className = "lookBadge";
      badge.textContent = "🏅";
      badge.title = look.name || "";
      btn.appendChild(badge);
    }
    btn.onclick = () => {
      SK.skin = normalizeSkin(look.skin);
      buildSkinEditor();                      // move every "selected" mark to match
      updatePriceTag();
    };
    lookBtns.push({ btn, look });
    row.appendChild(btn);
    // Draw it AFTER the button is in the page, so the canvas has a size.
    const c = cv.getContext("2d");
    drawPlayer(c, cv.width / 2, cv.height / 2, 0, normalizeSkin(look.skin), cv.width * 0.62);
  }
  markSelectedLook();
}

// Light up whichever look matches the cube on the screen right now. This runs
// on every tap, so it only ever moves a highlight — it never redraws the cubes.
function markSelectedLook() {
  for (const { btn, look } of lookBtns) {
    btn.classList.toggle("selected", sameSkin(look.skin, SK.skin));
  }
}

/* ----------------------------------------------------------------
   THE PRICE TAG. Every time you change something we work out what
   this cube would cost — only the parts you actually changed — and
   put it right on the Save button, so there are never any surprises.
   Changing your mind back makes it free again.
   ---------------------------------------------------------------- */
function updatePriceTag() {
  const saveBtn = document.getElementById("skinSaveBtn");
  const tag = document.getElementById("skinPrice");
  if (!saveBtn) return;
  markSelectedLook();          // keep My Looks in step with the cube on screen

  // A level's look isn't bought by anybody, so there's no price to show.
  if (SK.mode === "level") {
    saveBtn.textContent = "⇩ Use this look";
    saveBtn.disabled = false;
    if (tag) tag.textContent = "Everybody plays this level as this cube — and keeps it when they finish it.";
    return;
  }

  const { items, total } = skinCost(SK.savedSkin, SK.skin);

  if (!havePrices() || total === 0) {
    saveBtn.textContent = "⇩ Save";
    saveBtn.disabled = false;
    // Free for one of two reasons: you changed nothing, or this is a cube
    // you already own. Say which — "free!" is nicer when you know why.
    if (tag) {
      tag.textContent = !havePrices() ? ""
        : sameSkin(SK.skin, SK.savedSkin) ? "No changes — free!"
        : "You've already got this one — free!";
    }
    return;
  }

  const purse = balance();
  if (total > purse) {
    saveBtn.textContent = "Need " + (total - purse) + " more";
    saveBtn.disabled = true;
  } else {
    saveBtn.textContent = "⇩ Save — " + total + " coins";
    saveBtn.disabled = false;
  }
  // The itemised list, so it's obvious WHY it costs what it costs.
  if (tag) {
    tag.textContent = items.map(i => i.part + " " + i.price).join("  ·  ") +
      "   (you have 💰 " + purse + ")";
  }
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
      updatePriceTag();
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
    updatePriceTag();
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
      updatePriceTag();
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
    updatePriceTag();
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

// Save the cube — which is also BUYING it, if you changed anything.
// The server adds up the real price and takes the coins; if you can't
// afford it, it says so kindly and nothing is charged.
//
// In "level" mode nothing is bought and nothing is sent anywhere: the
// look simply goes back to the level editor, which saves it with the level.
async function saveSkin() {
  if (SK.mode === "level") {
    const name = lookNameInput.value.trim();
    if (!name) { showToast("Give the look a name first — like The Crow!"); return; }
    SK.onDone({ name, skin: normalizeSkin(SK.skin) });
    return;
  }

  const me = getMe();
  if (!me) { showToast("Log in first to save your cube!"); return; }
  const body = { name: SK.name, skin: normalizeSkin(SK.skin) };
  try {
    const result = await apiWrite("PUT", "/accounts/" + me.id, body);
    showToast(result.spent > 0 ? "Saved! −" + result.spent + " coins" : "Saved!");
    // From now on, THIS is the cube we compare against — so tapping Save
    // twice doesn't charge twice.
    SK.savedSkin = { ...normalizeSkin(result.account.skin) };
    await onSaved(result.account);   // main.js updates the purse and goes back
  } catch (e) { showToast(e.message); }
}

document.getElementById("skinSaveBtn").onclick = saveSkin;
// "No look" takes a level's cube away again, so it's played as whoever you are.
noLookBtn.onclick = () => { if (SK.mode === "level") SK.onDone(null); };
document.getElementById("skinBackBtn").onclick = () => {
  if (SK.mode === "level") { SK.onCancel(); return; }   // back to the level, unchanged
  S.screen = "menu"; showScreen("menuScreen");
};
document.getElementById("skinDeathBtn").onclick = previewDeath;
document.getElementById("skinPreview").addEventListener("pointerdown", e => { e.stopPropagation(); previewJump(); });
