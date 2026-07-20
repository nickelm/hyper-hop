// ============================================================
// effects.js — the pretty extras: trails and explosions.
// ============================================================
// The glowing trail behind the cube and the burst of pieces when it
// dies. These are LOOKS ONLY — they never change how the game plays.
// Each takes the array to work on (the game passes its own; the cube-
// editor preview passes its own), so nothing here needs a global.

import { CONFIG } from "../config.js";

// Draw the glowing trail behind the cube, in whatever style the skin picked.
// It takes the trail array so the editor preview can pass its own. CONFIG.TRAIL
// is still the master on/off switch, exactly like before.
export function drawTrail(ctx, sx, sy, skin, dt, trailArr, dead) {
  if (!CONFIG.TRAIL || skin.trail === "off" || dead) return;
  let i = 0;
  for (const t of trailArr) {
    t.life -= dt * 1.6;
    if (t.life <= 0) { i++; continue; }
    const x = sx(t.x), y = sy(t.y), k = CONFIG.PLAYER_SIZE * t.life * 0.7;
    if (skin.trail === "bubbles") {
      ctx.globalAlpha = t.life * 0.4; ctx.fillStyle = skin.bodyColor;
      ctx.beginPath(); ctx.arc(x, y, k * 0.5, 0, Math.PI * 2); ctx.fill();
    } else if (skin.trail === "rainbow") {
      ctx.globalAlpha = t.life * 0.5;
      ctx.fillStyle = "hsl(" + ((i * 30) % 360) + ",90%,60%)";
      ctx.fillRect(x - k / 2, y - k / 2, k, k);
    } else {              // "fade" — the classic trail, in the cube's own color
      ctx.globalAlpha = t.life * 0.35; ctx.fillStyle = skin.bodyColor;
      ctx.fillRect(x - k / 2, y - k / 2, k, k);
    }
    i++;
  }
  ctx.globalAlpha = 1;
}

// Make the cube explode into pieces. Each piece remembers the style + color +
// emoji so the look can't change halfway through. Count stays CONFIG.PARTICLES_ON_DEATH.
// Takes the particle array so the editor preview can pass its own.
export function spawnExplosion(x, y, skin, partArr) {
  for (let i = 0; i < CONFIG.PARTICLES_ON_DEATH; i++) {
    const a = Math.random() * Math.PI * 2, sp = 150 + Math.random() * 450;
    partArr.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, life: 1,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 12,
      style: skin.explosion, color: skin.bodyColor, emoji: skin.emoji,
      hue: (i * 47) % 360,
    });
  }
}

// Draw one small star (5 points) at the origin. Used by the "stars" explosion.
function drawStar(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = (i % 2 === 0) ? r : r * 0.45;
    const a = Math.PI / 180 * (36 * i - 90);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
}

// Move and draw the explosion pieces, in whatever style each piece remembers.
// Takes the particle array (so the editor preview can pass its own) and which
// way gravity points, so the pieces fall the same way the cube would.
export function renderParticles(ctx, sx, sy, dt, partArr, gravityDir) {
  for (const p of partArr) {
    p.life -= dt * 1.2; if (p.life <= 0) continue;
    p.vy += CONFIG.GRAVITY * 0.4 * gravityDir * dt; p.x += p.vx * dt; p.y += p.vy * dt;  // pieces fall the way gravity points
    if (p.vr) p.rot += p.vr * dt;
    ctx.globalAlpha = p.life;
    const x = sx(p.x), y = sy(p.y), style = p.style || "squares";
    if (style === "emoji") {
      ctx.font = "16px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(p.emoji || "😀", x, y);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    } else if (style === "stars") {
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot || 0);
      ctx.fillStyle = p.color || CONFIG.PLAYER_COLOR; drawStar(ctx, 8); ctx.restore();
    } else if (style === "confetti") {
      ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot || 0);
      ctx.fillStyle = "hsl(" + (p.hue || 0) + ",90%,60%)"; ctx.fillRect(-5, -3, 10, 6); ctx.restore();
    } else {             // "squares" — the classic 8×8 pieces
      ctx.fillStyle = p.color || CONFIG.PLAYER_COLOR;
      ctx.fillRect(x - 4, y - 4, 8, 8);
    }
  }
  ctx.globalAlpha = 1;
}
