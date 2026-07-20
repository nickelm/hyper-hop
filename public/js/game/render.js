// ============================================================
// render.js — draw the whole scene each frame.
// ============================================================
// Everything you SEE while playing: the sky and ground, every tile,
// the checkpoint flags, the cube (via player.js), its trail and death
// explosion (via effects.js), the HUD, and the win/death overlays.
//
// draw() needs a lot of the game's state, so index.html hands it a
// `view` — a live window onto the game's variables. It reads most of
// them, and writes a few (the win/death timers) and asks the game to
// respawn, all through that view.

import { CONFIG, THEMES } from "../config.js";
import { tileAt, cellTop } from "./level.js";
import { drawPlayer } from "./player.js";
import { drawTrail, renderParticles } from "./effects.js";

// Draw the top players for a level, centered on cx starting at y. Returns the
// y just below the last line, so the caller can keep drawing under it.
function drawLeaderboard(ctx, view, cx, y, levelId) {
  const board = view.leaderboardFor(levelId).slice(0, CONFIG.LEADERBOARD_TOP);
  if (!board.length) return y;
  ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "bold 16px Trebuchet MS";
  ctx.fillText("🏆 Best scores", cx, y); y += 26;
  ctx.font = "bold 20px Trebuchet MS";
  board.forEach((s, i) => {
    // Your own line glows so you can spot it in the list.
    ctx.fillStyle = (s.player === view.playerName) ? "#7dff5e" : "#fff";
    ctx.fillText((i + 1) + ". " + s.player + " — " + s.percent + "%", cx, y);
    y += 26;
  });
  return y;
}

export function draw(view, dt) {
  // A live snapshot of the game state we need this frame (see gameView).
  const ctx = view.ctx, W = view.W, H = view.H;
  const camX = view.camX, player = view.player, gravityDir = view.gravityDir;
  const coinsGot = view.coinsGot, trail = view.trail, particles = view.particles;
  const checkpoints = view.checkpoints, activatedCheckpoints = view.activatedCheckpoints, bridgeFades = view.bridgeFades;
  const totalCoins = view.totalCoins, attempts = view.attempts, runPercent = view.runPercent, runWasBest = view.runWasBest;
  const S = view.S;
  const T = CONFIG.TILE;
  // The level's theme decides the background colors. Theme 0 ("Default"), and
  // the menu, use the Control Panel colors instead.
  const theme = (S.screen === "game" && S.themeIndex) ? THEMES[S.themeIndex] : null;
  const skyTop    = (theme && theme.SKY_TOP)    ? theme.SKY_TOP    : CONFIG.SKY_TOP;
  const skyBottom = (theme && theme.SKY_BOTTOM) ? theme.SKY_BOTTOM : CONFIG.SKY_BOTTOM;
  const groundColor = (theme && theme.GROUND)   ? theme.GROUND     : CONFIG.GROUND_COLOR;
  // background
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, skyTop); sky.addColorStop(1, skyBottom);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  if (S.screen !== "game" || !S.level) return;

  // camera: floor sits at 78% of screen height; player is 30% from the left
  const floorY = H * 0.78;
  const sx = wx => (wx - camX);
  const sy = wy => (floorY + wy);
  let shakeX = 0, shakeY = 0;
  if (view.shake > 0.5) { shakeX = (Math.random()-0.5) * view.shake; shakeY = (Math.random()-0.5) * view.shake; view.shake *= 0.9; }
  ctx.save(); ctx.translate(shakeX, shakeY);

  // Fade the beat pulse a little every frame (the music sets it back to 1 on
  // each beat). We use it below to make the world flash gently in time.
  view.beatPulse = Math.max(0, view.beatPulse - dt * 4);

  // parallax dots — brighter for a moment on the beat
  ctx.fillStyle = "rgba(255,255,255," + (0.15 + view.beatPulse * 0.35) + ")";
  for (let i = 0; i < 40; i++) {
    const px = ((i * 353 - camX * 0.3) % (W + 100) + W + 100) % (W + 100) - 50;
    const py = (i * 197) % (floorY - 40);
    ctx.fillRect(px, py, 3, 3);
  }

  // ground
  ctx.fillStyle = groundColor; ctx.fillRect(0, floorY, W, H - floorY);
  // the bright line on top of the floor thickens and glows a touch on the beat
  ctx.fillStyle = "rgba(255,255,255," + (0.6 + view.beatPulse * 0.4) + ")";
  ctx.fillRect(0, floorY, W, 3 + view.beatPulse * 3);
  ctx.fillStyle = "rgba(255,255,255,.08)";
  for (let gx = -((camX) % (T*2)); gx < W; gx += T*2) ctx.fillRect(gx, floorY + 6, T, H);

  // tiles
  const colStart = Math.floor(camX / T) - 1, colEnd = Math.floor((camX + W) / T) + 1;
  for (let col = colStart; col <= colEnd; col++) {
    for (let row = 0; row < S.level.rows; row++) {
      const ch = tileAt(S.level, col, row);
      if (ch === ".") continue;
      const x = sx(col * T), y = sy(cellTop(S.level, row));
      if (ch === "#") {
        ctx.fillStyle = CONFIG.BLOCK_COLOR; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = CONFIG.BLOCK_EDGE; ctx.fillRect(x, y, T, 4);
        ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(x, y + T - 5, T, 5);
      } else if (ch === "/" || ch === "\\") {
        // a ramp: a filled right triangle in the block color, with a white edge
        // along its slope (like the block's white top edge)
        ctx.fillStyle = CONFIG.BLOCK_COLOR;
        ctx.beginPath();
        if (ch === "/") {            // solid below the slope: bottom-left, bottom-right, top-right
          ctx.moveTo(x, y + T); ctx.lineTo(x + T, y + T); ctx.lineTo(x + T, y);
        } else {                     // solid below the slope: top-left, bottom-right, bottom-left
          ctx.moveTo(x, y); ctx.lineTo(x + T, y + T); ctx.lineTo(x, y + T);
        }
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = CONFIG.BLOCK_EDGE; ctx.lineWidth = 4;
        ctx.beginPath();
        if (ch === "/") { ctx.moveTo(x, y + T); ctx.lineTo(x + T, y); }
        else            { ctx.moveTo(x, y); ctx.lineTo(x + T, y + T); }
        ctx.stroke();
      } else if (ch === "^") {
        ctx.fillStyle = CONFIG.SPIKE_COLOR;
        ctx.beginPath(); ctx.moveTo(x + T/2, y + 2); ctx.lineTo(x + T - 3, y + T); ctx.lineTo(x + 3, y + T);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      } else if (ch === "s") {
        // a spinning toothed saw disc (the spin is only for looks)
        const cx = x + T/2, cy = y + T/2, rad = CONFIG.SAW_RADIUS * T;
        const spin = performance.now() / 200;
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(spin);
        ctx.fillStyle = CONFIG.SPIKE_COLOR;
        const teeth = 8;
        ctx.beginPath();
        for (let i = 0; i < teeth * 2; i++) {
          const rr = (i % 2 === 0) ? rad : rad * 0.68;   // tooth tip, then notch
          const a = (i / (teeth * 2)) * Math.PI * 2;
          const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#fff";                          // hub in the middle
        ctx.beginPath(); ctx.arc(0, 0, rad * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (ch === "o") {
        ctx.fillStyle = CONFIG.PAD_COLOR;
        ctx.beginPath(); ctx.ellipse(x + T/2, y + T - 6, T/2 - 3, 8, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(x + 3, y + T - 8, T - 6, 5);
      } else if (ch === "p") {                    // small pink pad — like o but smaller
        ctx.fillStyle = CONFIG.SMALL_PAD_COLOR;
        ctx.beginPath(); ctx.ellipse(x + T/2, y + T - 5, T/4, 5, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(x + T/4, y + T - 6, T/2, 4);
      } else if (ch === "U") {                    // catapult — a wide yellow bucket
        ctx.fillStyle = CONFIG.CATAPULT_COLOR;
        ctx.fillRect(x + 3, y + T - 6, T - 6, 5);         // base
        ctx.fillRect(x + 3, y + T/3, 5, T - T/3);         // left wall
        ctx.fillRect(x + T - 8, y + T/3, 5, T - T/3);     // right wall
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;      // a little rim so it reads as a bucket
        ctx.strokeRect(x + 3, y + T/3, T - 6, T - T/3 - 1);
      } else if (ch === "*") {
        if (coinsGot.has(col + "," + row)) continue;
        const bob = Math.sin(performance.now() / 250 + col) * 4;
        ctx.fillStyle = CONFIG.COIN_COLOR;
        ctx.beginPath(); ctx.arc(x + T/2, y + T/2 + bob, T/3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x + T/2, y + T/2 + bob, T/3 - 6, 0, Math.PI * 2); ctx.stroke();
      } else if (ch === "|") {
        ctx.fillStyle = "#fff"; ctx.fillRect(x + T/2 - 3, y - T, 6, T * 2 + (S.level.rows) * 0);
        for (let f = 0; f < 3; f++) {
          ctx.fillStyle = f % 2 ? "#fff" : "#111";
          ctx.fillRect(x + T/2 + 3, y - T + f * 10, 26, 10);
        }
      } else if (ch === "@") {
        // a little checkpoint flag. Once you've touched it, it lights up green
        // and raises to the top of its pole.
        const lit = activatedCheckpoints.has(col + "," + row);
        const poleX = x + T/2, flagY = y + (lit ? 2 : 12);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(poleX, y + T); ctx.lineTo(poleX, flagY); ctx.stroke();
        ctx.fillStyle = lit ? "#7dff5e" : "#8a8aa0";   // lit = bright green, else grey
        ctx.beginPath();
        ctx.moveTo(poleX, flagY); ctx.lineTo(poleX + 16, flagY + 6); ctx.lineTo(poleX, flagY + 12);
        ctx.closePath(); ctx.fill();
      } else if (ch === ">" || ch === "<") {
        // a full-height shimmering gate filling this column. Green = faster, blue = slower.
        const topY = sy(cellTop(S.level, 0)), botY = sy(0), gh = botY - topY;
        const color = ch === ">" ? "#3dff7a" : "#3aa0ff";
        ctx.save();
        ctx.globalAlpha = 0.22; ctx.fillStyle = color; ctx.fillRect(x, topY, T, gh);
        ctx.globalAlpha = 0.9;                          // bright edges
        ctx.fillRect(x, topY, 3, gh); ctx.fillRect(x + T - 3, topY, 3, gh);
        ctx.globalAlpha = 0.5;                          // shimmer lines drifting upward
        const t2 = performance.now() / 400;
        for (let k = 0; k < 3; k++) {
          const yy = botY - (((t2 + k / 3) % 1) * gh);
          ctx.fillRect(x + 4, yy, T - 8, 3);
        }
        ctx.globalAlpha = 1; ctx.fillStyle = "#fff";    // an arrow hint in the middle
        ctx.font = "bold 20px Trebuchet MS"; ctx.textAlign = "center";
        ctx.fillText(ch === ">" ? "»" : "«", x + T/2, topY + gh/2 + 7);
        ctx.textAlign = "left";
        ctx.restore();
      } else if (ch === "u" || ch === "n") {
        // a full-height gravity gate. Purple ( u ) flips gravity up, cyan ( n )
        // sets it back to normal. The arrow shows which way DOWN becomes.
        const topY = sy(cellTop(S.level, 0)), botY = sy(0), gh = botY - topY;
        const color = ch === "u" ? "#b06bff" : "#3ff0ff";
        ctx.save();
        ctx.globalAlpha = 0.22; ctx.fillStyle = color; ctx.fillRect(x, topY, T, gh);
        ctx.globalAlpha = 0.9;                          // bright edges
        ctx.fillRect(x, topY, 3, gh); ctx.fillRect(x + T - 3, topY, 3, gh);
        ctx.globalAlpha = 1; ctx.fillStyle = "#fff";    // ↑ = down is now up ;  ↓ = normal
        ctx.font = "bold 22px Trebuchet MS"; ctx.textAlign = "center";
        ctx.fillText(ch === "u" ? "↑" : "↓", x + T/2, topY + gh/2 + 8);
        ctx.textAlign = "left";
        ctx.restore();
      } else if (ch === "=" || ch === "-") {
        // A thin slab across the top third of the tile (that's the part you land on).
        const th = T / 3;
        let alpha = 1;
        if (ch === "-") {                    // a bridge slowly fades once you've run past it
          const key = col + "," + row;
          if (bridgeFades[key] !== undefined) {
            bridgeFades[key] = Math.max(0, bridgeFades[key] - dt / CONFIG.BRIDGE_FADE_TIME);
            alpha = bridgeFades[key];
          }
          if (alpha <= 0) continue;          // fully faded: draw nothing (it stays gone)
        }
        ctx.globalAlpha = alpha;
        if (ch === "=") {                    // solid slab with a white top edge
          ctx.fillStyle = CONFIG.BLOCK_COLOR; ctx.fillRect(x, y, T, th);
          ctx.fillStyle = CONFIG.BLOCK_EDGE;  ctx.fillRect(x, y, T, 3);
        } else {                             // three planks with gaps, so it reads as a bridge
          const plank = (T - 8) / 3;
          for (let p = 0; p < 3; p++) {
            const px = x + 2 + p * (plank + 2);
            ctx.fillStyle = CONFIG.BLOCK_COLOR; ctx.fillRect(px, y, plank, th);
            ctx.fillStyle = CONFIG.BLOCK_EDGE;  ctx.fillRect(px, y, plank, 3);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // checkpoint flags (practice mode) — little green flags you can respawn at
  for (const cp of checkpoints) {
    const fx = sx(cp.x), fy = sy(cp.y), hs = CONFIG.PLAYER_SIZE / 2;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(fx, fy + hs); ctx.lineTo(fx, fy - hs - 14); ctx.stroke();
    ctx.fillStyle = "#7dff5e";
    ctx.beginPath();
    ctx.moveTo(fx, fy - hs - 14); ctx.lineTo(fx + 20, fy - hs - 8); ctx.lineTo(fx, fy - hs - 2);
    ctx.closePath(); ctx.fill();
  }

  // Work out the cube's skin once for this frame (see activeSkin).
  const skin = view.activeSkin();

  // trail — the skin picks the style; CONFIG.TRAIL is still the master switch
  drawTrail(ctx, sx, sy, skin, dt, trail, player.dead);

  // player — view.squash-stretch after a catapult, and flipped upside down when
  // gravity is reversed (scaling Y by gravityDir flips the face AND, because a
  // mirror reverses rotation, makes the spin go the other way).
  if (view.squash > 0) view.squash = Math.max(0, view.squash - dt * 4);   // fades out in about a quarter second
  if (!player.dead) {
    ctx.save();
    ctx.translate(sx(player.x), sy(player.y));
    const sqx = view.squash > 0 ? (1 - view.squash * 0.3) : 1;
    const sqy = view.squash > 0 ? (1 + view.squash * 0.45) : 1;
    ctx.scale(sqx, sqy * gravityDir);
    drawPlayer(ctx, 0, 0, player.rot, skin);
    ctx.restore();
  }

  // particles (the death explosion) — each piece carries its own style/color
  renderParticles(ctx, sx, sy, dt, particles, gravityDir);
  ctx.restore();

  // progress bar + coins
  const prog = view.levelProgress();
  document.getElementById("progressFill").style.width = (prog * 100) + "%";
  ctx.fillStyle = "#fff"; ctx.font = "bold 18px Trebuchet MS"; ctx.textAlign = "right";
  ctx.fillText("\u25CF " + coinsGot.size + " / " + totalCoins, W - 16, 30);
  ctx.textAlign = "left";

  // "from checkpoint" tag under the attempt counter, for a couple of seconds
  if (view.checkpointTagT > 0) {
    view.checkpointTagT = Math.max(0, view.checkpointTagT - dt);
    ctx.globalAlpha = Math.min(1, view.checkpointTagT);   // gently fade away at the end
    ctx.fillStyle = "#7dff5e"; ctx.font = "bold 15px Trebuchet MS"; ctx.textAlign = "center";
    ctx.fillText("from checkpoint", W / 2, 60);
    ctx.textAlign = "left"; ctx.globalAlpha = 1;
  }

  // win / death overlays
  if (player.won) {
    view.winT += dt;
    ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    let y = H/2 - 120;
    ctx.fillStyle = "#7dff5e"; ctx.font = "bold 54px Trebuchet MS";
    ctx.fillText("LEVEL COMPLETE!", W/2, y); y += 44;
    ctx.fillStyle = "#fff"; ctx.font = "bold 22px Trebuchet MS";
    ctx.fillText("Coins: " + coinsGot.size + " / " + totalCoins + "   Attempts: " + attempts, W/2, y); y += 34;
    if (runWasBest) {                          // you just beat your old record
      ctx.fillStyle = "#ffe14d"; ctx.font = "bold 26px Trebuchet MS";
      ctx.fillText("NEW BEST! 🎉", W/2, y);
    }
    y += 34;
    y = drawLeaderboard(ctx, view, W/2, y, S.levelId);    // the top players for this level
    ctx.fillStyle = "#fff"; ctx.font = "18px Trebuchet MS";
    if (view.winT > 0.8) ctx.fillText("Tap to continue", W/2, y + 20);
    ctx.textAlign = "left";
  }
  if (player.dead) {
    view.deadT += dt;
    // A quick "how far did you get?" note while the cube is exploding, before
    // the level starts over. (Only for real levels, not editor test runs.)
    if (S.levelId != null) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff"; ctx.font = "bold 30px Trebuchet MS";
      let line = "You reached " + runPercent + "%";
      const best = view.myBest(S.levelId);
      if (best != null) line += "   ·   Best " + best + "%";
      ctx.fillText(line, W/2, H/2 - 40);
      if (runWasBest) {
        ctx.fillStyle = "#ffe14d"; ctx.font = "bold 24px Trebuchet MS";
        ctx.fillText("NEW BEST! 🎉", W/2, H/2);
      }
      ctx.textAlign = "left";
    }
    // Come back at: a practice-mode flag if you dropped one, else your latest
    //  @  checkpoint, else start the whole level over.
    if (view.deadT > 0.9) {
      if (S.practice && checkpoints.length > 0) view.restoreCheckpoint();
      else if (tileCheckpoint) view.restoreTileCheckpoint();
      else view.resetRun();
    }
  }
}
