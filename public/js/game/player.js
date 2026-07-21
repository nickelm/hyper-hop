// ============================================================
// player.js — how the cube LOOKS (the skin), drawn on a canvas.
// ============================================================
// One place that knows how to draw a cube with a given skin: its
// shape, colors, and face. The game, the cube-editor preview, and the
// little cubes on the player buttons all draw through here, so they
// always match. Looks only — the cube's hitbox is always a plain
// CONFIG.PLAYER_SIZE square (see the note on drawPlayer).

import { CONFIG, DEFAULT_SKIN, SHAPES, FACES, TRAIL_STYLES, EXPLOSION_STYLES } from "../config.js";

// Turn a rainbow-slider hue (0–360) into a "#rrggbb" color. We keep the
// color bright and punchy (fixed saturation + lightness) so every hue looks
// good on a cube. Returns 6 hex digits, which is exactly what the server wants.
export function hslToHex(hue) {
  const s = 0.85, l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((hue % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = l - c / 2;
  const hex = v => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + hex(r) + hex(g) + hex(b);
}

// Take whatever skin we were handed (from the server, an old save, or a
// half-built one in the editor) and return a complete, safe skin. This NEVER
// throws — every bad or missing part is replaced by the default. Because we
// call it everywhere a skin is used, a broken skin can never crash the game.
export function normalizeSkin(raw) {
  const s = (raw && typeof raw === "object") ? raw : {};
  const isColor = v => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  const pick = (v, list, def) => list.includes(v) ? v : def;
  // Keep only the FIRST emoji someone typed (a whole emoji, even a fancy one).
  let emoji = DEFAULT_SKIN.emoji;
  if (typeof s.emoji === "string" && s.emoji.trim()) {
    const first = (typeof Intl !== "undefined" && Intl.Segmenter)
      ? [...new Intl.Segmenter().segment(s.emoji.trim())][0].segment
      : [...s.emoji.trim()][0];
    if (first) emoji = first;
  }
  return {
    bodyColor:    isColor(s.bodyColor)    ? s.bodyColor    : DEFAULT_SKIN.bodyColor,
    outlineColor: isColor(s.outlineColor) ? s.outlineColor : DEFAULT_SKIN.outlineColor,
    faceColor:    isColor(s.faceColor)    ? s.faceColor    : DEFAULT_SKIN.faceColor,
    shape:     pick(s.shape,     SHAPES,           DEFAULT_SKIN.shape),
    face:      pick(s.face,      FACES,            DEFAULT_SKIN.face),
    emoji,
    trail:     pick(s.trail,     TRAIL_STYLES,     DEFAULT_SKIN.trail),
    explosion: pick(s.explosion, EXPLOSION_STYLES, DEFAULT_SKIN.explosion),
  };
}

/* ----------------------------------------------------------------
   ARE THESE THE SAME CUBE? Two cubes are the same LOOK when every
   part of them matches. My Looks uses this to tell whether you
   already own the cube you're building — an owned look is free.

   The server has its own copy of this in server/lib/looks.js. If you
   change one, change the other — but the server is the one that
   really decides what you own and what it costs.
   ---------------------------------------------------------------- */
export function sameSkin(a, b) {
  if (!a || !b) return false;
  const one = normalizeSkin(a), two = normalizeSkin(b);
  return Object.keys(one).every(part => one[part] === two[part]);
}

// Draw just the cube's OUTLINE SHAPE at the origin (already moved + rotated),
// then fill and stroke it. hs is half the cube's size.
function drawShape(ctx, shape, hs) {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(0, 0, hs, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    ctx.moveTo(0, -hs); ctx.lineTo(hs, 0); ctx.lineTo(0, hs); ctx.lineTo(-hs, 0);
    ctx.closePath();
  } else if (shape === "hex") {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const x = Math.cos(a) * hs, y = Math.sin(a) * hs;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (shape === "rounded") {
    const r = hs * 0.4;
    if (ctx.roundRect) { ctx.roundRect(-hs, -hs, hs * 2, hs * 2, r); }
    else {               // older browsers: build the rounded box by hand
      ctx.moveTo(-hs + r, -hs);
      ctx.arcTo(hs, -hs, hs, hs, r); ctx.arcTo(hs, hs, -hs, hs, r);
      ctx.arcTo(-hs, hs, -hs, -hs, r); ctx.arcTo(-hs, -hs, hs, -hs, r);
      ctx.closePath();
    }
  } else {               // "square" — the classic cube
    ctx.rect(-hs, -hs, hs * 2, hs * 2);
  }
  ctx.fill();
  ctx.stroke();
}

// Draw the cube's FACE at the origin (already moved + rotated). Faces are
// simple little shapes; "emoji" writes one emoji big in the middle.
function drawFace(ctx, skin, hs) {
  if (skin.face === "none") return;
  ctx.fillStyle = skin.faceColor;
  const lE = -hs * 0.45, rE = hs * 0.13, eyeW = hs * 0.32, eyeH = hs * 0.5, eyeY = -hs * 0.4;

  if (skin.face === "emoji") {
    ctx.font = (hs * 1.6) + "px serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(skin.emoji, 0, hs * 0.08);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";   // put it back for other text
    return;
  }
  if (skin.face === "happy") {          // the classic face: two eyes + a mouth
    ctx.fillRect(lE, eyeY, eyeW, eyeH);
    ctx.fillRect(rE, eyeY, eyeW, eyeH);
    ctx.fillRect(-hs * 0.35, hs * 0.25, hs * 0.7, hs * 0.18);
    return;
  }
  if (skin.face === "cool") {           // sunglasses bar + a little smile
    ctx.fillRect(-hs * 0.55, -hs * 0.25, hs * 1.1, hs * 0.28);
    ctx.fillRect(-hs * 0.3, hs * 0.32, hs * 0.6, hs * 0.12);
    return;
  }
  if (skin.face === "angry") {          // slanted brows + eyes + a frown
    ctx.fillRect(lE, eyeY + hs * 0.12, eyeW, eyeH * 0.7);
    ctx.fillRect(rE, eyeY + hs * 0.12, eyeW, eyeH * 0.7);
    ctx.save();
    ctx.rotate(0.35); ctx.fillRect(-hs * 0.5, -hs * 0.5, hs * 0.4, hs * 0.1); ctx.restore();
    ctx.save();
    ctx.rotate(-0.35); ctx.fillRect(hs * 0.1, -hs * 0.5, hs * 0.4, hs * 0.1); ctx.restore();
    ctx.fillRect(-hs * 0.3, hs * 0.42, hs * 0.6, hs * 0.12);
    return;
  }
  if (skin.face === "silly") {          // eyes + a tongue sticking out
    ctx.fillRect(lE, eyeY, eyeW, eyeH);
    ctx.fillRect(rE, eyeY, eyeW, eyeH);
    ctx.fillRect(-hs * 0.35, hs * 0.2, hs * 0.7, hs * 0.12);
    ctx.fillStyle = "#ff5ec6";          // a pink tongue, always cheerful
    ctx.fillRect(-hs * 0.1, hs * 0.28, hs * 0.2, hs * 0.28);
    return;
  }
  if (skin.face === "sleepy") {         // two closed-eye lines + a tiny mouth
    ctx.fillRect(lE, 0, eyeW, hs * 0.12);
    ctx.fillRect(rE, 0, eyeW, hs * 0.12);
    ctx.fillRect(-hs * 0.12, hs * 0.35, hs * 0.24, hs * 0.1);
    return;
  }
  if (skin.face === "robot") {          // rectangular eyes + an antenna on top
    ctx.fillRect(lE, eyeY, eyeW, eyeH * 0.7);
    ctx.fillRect(rE, eyeY, eyeW, eyeH * 0.7);
    ctx.fillRect(-hs * 0.3, hs * 0.3, hs * 0.6, hs * 0.1);
    ctx.fillRect(-hs * 0.04, -hs * 1.25, hs * 0.08, hs * 0.35);  // antenna wire
    ctx.beginPath(); ctx.arc(0, -hs * 1.3, hs * 0.12, 0, Math.PI * 2); ctx.fill(); // antenna dot
    return;
  }
}

// Draw the whole cube with a skin. Used by the game, the cube-editor preview,
// and the little cubes on the player buttons.
//
// COLLISION NOTE: the cube's hitbox is ALWAYS a CONFIG.PLAYER_SIZE square, no
// matter what shape/size we draw here. Skins are LOOKS ONLY — they never change
// where you can stand, what kills you, or how hard the level is. (the physics
// in js/game/physics.js only ever uses CONFIG.PLAYER_SIZE for the hitbox —
// never the drawn shape.)
export function drawPlayer(ctx, x, y, rot, skin, size) {
  const s = normalizeSkin(skin);
  const hs = (size || CONFIG.PLAYER_SIZE) / 2;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot * Math.PI / 180);
  ctx.fillStyle = s.bodyColor;
  ctx.strokeStyle = s.outlineColor; ctx.lineWidth = 3;
  drawShape(ctx, s.shape, hs);
  drawFace(ctx, s, hs);
  ctx.restore();
}
