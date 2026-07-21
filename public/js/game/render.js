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
import { tileAt, cellTop, skyTop, worldBottom, groundSpans, messageAt } from "./level.js";
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

/* ----------------------------------------------------------------
   A SIGN ( ! ) — a little board on a post with a message on it, so a
   level can tell you what to do ("HOLD to fly up!"). It is only a
   picture: the physics doesn't know signs exist, so you run straight
   through one. x,y is the top-left of its square.
   ---------------------------------------------------------------- */
const SIGN_LINE_CHARS = 22;      // longer messages wrap onto another line

// Break a message into short lines, never splitting a word in half.
function signLines(text) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (line && (line + " " + word).length > SIGN_LINE_CHARS) { lines.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

function drawSign(ctx, x, y, text) {
  const T = CONFIG.TILE, size = CONFIG.SIGN_TEXT_SIZE;
  const lines = signLines(text);
  ctx.font = "bold " + size + "px Trebuchet MS";
  ctx.textAlign = "center";
  // How big does the board have to be to fit the words?
  let widest = T * 0.7;
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
  const boardW = widest + 18, boardH = lines.length * (size + 4) + 12;
  const midX = x + T / 2;
  const boardBottom = y + T * 0.55;                 // the post pokes out below it
  // the post
  ctx.fillStyle = CONFIG.SIGN_TEXT_COLOR;
  ctx.fillRect(midX - 3, boardBottom - 2, 6, T * 0.45 + 2);
  // the board
  ctx.fillStyle = CONFIG.SIGN_COLOR;
  ctx.strokeStyle = CONFIG.SIGN_TEXT_COLOR; ctx.lineWidth = 3;
  const bx = midX - boardW / 2, by = boardBottom - boardH;
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx, by, boardW, boardH, 8); ctx.fill(); ctx.stroke(); }
  else { ctx.fillRect(bx, by, boardW, boardH); ctx.strokeRect(bx, by, boardW, boardH); }
  // the words
  ctx.fillStyle = CONFIG.SIGN_TEXT_COLOR;
  lines.forEach((line, i) => ctx.fillText(line, midX, by + 10 + size + i * (size + 4) - 4));
  ctx.textAlign = "left";
}

export function draw(view, dt) {
  // A live snapshot of the game state we need this frame (see gameView).
  const ctx = view.ctx, W = view.W, H = view.H;
  const camX = view.camX, player = view.player, gravityDir = view.gravityDir;
  const coinsGot = view.coinsGot, trail = view.trail, particles = view.particles;
  const checkpoints = view.checkpoints, activatedCheckpoints = view.activatedCheckpoints, bridgeFades = view.bridgeFades;
  const totalCoins = view.totalCoins, attempts = view.attempts, runPercent = view.runPercent, runWasBest = view.runWasBest;
  const tileCheckpoint = view.tileCheckpoint;
  // Coins: what's in your purse, which coins here you've already been paid
  // for (they draw silver), and what this run just earned you.
  const coinBalance = view.coinBalance, alreadyEarned = view.alreadyEarned;
  const runCoinsEarned = view.runCoinsEarned;
  const S = view.S;
  const T = CONFIG.TILE;
  // The level's theme decides the background colors. Theme 0 ("Default"), and
  // the menu, use the Control Panel colors instead.
  const theme = (S.screen === "game" && S.themeIndex) ? THEMES[S.themeIndex] : null;
  const skyTopColor    = (theme && theme.SKY_TOP)    ? theme.SKY_TOP    : CONFIG.SKY_TOP;
  const skyBottomColor = (theme && theme.SKY_BOTTOM) ? theme.SKY_BOTTOM : CONFIG.SKY_BOTTOM;
  const groundColor    = (theme && theme.GROUND)     ? theme.GROUND     : CONFIG.GROUND_COLOR;
  // background
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, skyTopColor); sky.addColorStop(1, skyBottomColor);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  if (S.screen !== "game" || !S.level) return;

  // camera: the floor sits at 78% of the screen height, same as always. Above it
  // we squeeze the whole sky in, so a tall level always fits on the screen —
  // on a big tablet or a little phone. That squeeze is the `zoom`.
  const floorY = H * CONFIG.CAMERA_FLOOR_Y;
  const zoom = floorY / -skyTop(S.level);
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

  // From here on we draw the WORLD, in plain world sizes: one squeeze of the
  // canvas and a nudge down to the floor line, and then a block really is TILE
  // wide. (Doing it this way shrinks the outlines and letters to match too.)
  ctx.save();
  ctx.translate(0, floorY);
  ctx.scale(zoom, zoom);
  // The camera: the cube sits CONFIG.CAMERA_X of the way across the screen. We
  // measure from the cube itself, so it sits in the same spot on a little phone
  // and on a big tablet.
  const camLeft = player.x - (W * CONFIG.CAMERA_X) / zoom;   // world x at the screen's left edge
  const sx = wx => (wx - camLeft);
  const sy = wy => wy;

  const colStart = Math.floor(camLeft / T) - 1, colEnd = Math.floor((camLeft + W / zoom) / T) + 1;

  /* ---- the ground ----
     Drawn column by column, because an  h  gate can switch it off and leave a
     hole with nothing but sky underneath. We draw it in RUNS of neighbouring
     columns rather than one rectangle per tile, so there are no seams. */
  const groundOn = groundSpans(S.level);
  const groundOnCol = (col) => {
    if (S.level.cols === 0) return true;
    if (col < 0) return true;                       // the run-up before the level starts
    if (col >= S.level.cols) return groundOn[S.level.cols - 1];   // and on past the end
    return groundOn[col];
  };
  const groundDepth = worldBottom(S.level);         // fill right down to the bottom of the screen
  const drawGroundRun = (from, to) => {             // columns [from, to)
    const x = sx(from * T), w = (to - from) * T;
    ctx.fillStyle = groundColor; ctx.fillRect(x, 0, w, groundDepth);
    // the bright line on top of the floor thickens and glows a touch on the beat
    ctx.fillStyle = "rgba(255,255,255," + (0.6 + view.beatPulse * 0.4) + ")";
    ctx.fillRect(x, 0, w, 3 + view.beatPulse * 3);
    ctx.fillStyle = "rgba(255,255,255,.08)";        // the darker stripes, every other column
    for (let col = from; col < to; col++) {
      if ((((col % 2) + 2) % 2) === 0) ctx.fillRect(sx(col * T), 6, T, groundDepth);
    }
  };
  let runFrom = null;
  for (let col = colStart; col <= colEnd + 1; col++) {
    const on = (col <= colEnd) && groundOnCol(col);
    if (on && runFrom === null) runFrom = col;
    else if (!on && runFrom !== null) { drawGroundRun(runFrom, col); runFrom = null; }
  }

  // tiles (signs are collected as we go and drawn on top at the end)
  const signs = [];
  for (let col = colStart; col <= colEnd; col++) {
    for (let row = 0; row < S.level.rows; row++) {
      const ch = tileAt(S.level, col, row);
      if (ch === ".") continue;
      const x = sx(col * T), y = sy(cellTop(S.level, row));
      if (ch === "#") {
        ctx.fillStyle = CONFIG.BLOCK_COLOR; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = CONFIG.BLOCK_EDGE; ctx.fillRect(x, y, T, 4);
        ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(x, y + T - 5, T, 5);
      } else if (ch === "/" || ch === "\\" || ch === "L" || ch === "7") {
        // a ramp: a filled right triangle in the block color, with a white edge
        // along its slope (like the block's white top edge). The floor ramps
        // ( / and \ ) are solid BELOW their slope; the ceiling ones ( L and 7 )
        // are the same triangles turned upside down, solid above.
        ctx.fillStyle = CONFIG.BLOCK_COLOR;
        ctx.beginPath();
        if (ch === "/")      { ctx.moveTo(x, y + T); ctx.lineTo(x + T, y + T); ctx.lineTo(x + T, y); }
        else if (ch === "\\"){ ctx.moveTo(x, y); ctx.lineTo(x + T, y + T); ctx.lineTo(x, y + T); }
        else if (ch === "L") { ctx.moveTo(x, y); ctx.lineTo(x + T, y); ctx.lineTo(x + T, y + T); }
        else                 { ctx.moveTo(x, y); ctx.lineTo(x + T, y); ctx.lineTo(x, y + T); }
        ctx.closePath(); ctx.fill();
        // the white line along the slope — that's the surface you run on
        ctx.strokeStyle = CONFIG.BLOCK_EDGE; ctx.lineWidth = 4;
        ctx.beginPath();
        if (ch === "/" || ch === "7") { ctx.moveTo(x, y + T); ctx.lineTo(x + T, y); }
        else                          { ctx.moveTo(x, y); ctx.lineTo(x + T, y + T); }
        ctx.stroke();
      } else if (ch === "!") {
        // a sign: remember it and draw it AFTER all the tiles, so nothing
        // in the next column can scribble over the words.
        signs.push({ x, y, text: messageAt(S.level, col, row) });
      } else if (ch === "^" || ch === "v") {
        // a spike: a triangle with a white edge. A  v  is the same triangle turned
        // upside down — it hangs point-down from the roof instead of standing up
        // from the floor. Same color, so it reads as obviously the same danger.
        ctx.fillStyle = CONFIG.SPIKE_COLOR;
        ctx.beginPath();
        if (ch === "^") { ctx.moveTo(x + T/2, y + 2);     ctx.lineTo(x + T - 3, y + T); ctx.lineTo(x + 3, y + T); }
        else            { ctx.moveTo(x + T/2, y + T - 2); ctx.lineTo(x + T - 3, y);     ctx.lineTo(x + 3, y); }
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
        const coinKey = col + "," + row;
        if (coinsGot.has(coinKey)) continue;             // grabbed this run
        const bob = Math.sin(performance.now() / 250 + col) * 4;
        // A SILVER coin is one you've already been paid for. Still fun to
        // grab, but it won't add to your purse again — so you can see at a
        // glance which coins in this level still pay.
        const alreadyPaid = alreadyEarned.has(coinKey);
        ctx.fillStyle = alreadyPaid ? CONFIG.COIN_SILVER_COLOR : CONFIG.COIN_COLOR;
        ctx.beginPath(); ctx.arc(x + T/2, y + T/2 + bob, T/3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = alreadyPaid ? "rgba(255,255,255,.45)" : "#fff"; ctx.lineWidth = 3;
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
        const topY = sy(skyTop(S.level)), botY = sy(0), gh = botY - topY;
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
        const topY = sy(skyTop(S.level)), botY = sy(0), gh = botY - topY;
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
      } else if (ch === "f" || ch === "c") {
        // a full-height flight gate. Orange ( f ) turns you into a rocket you
        // steer by HOLDING the button; green ( c ) turns you back into a cube.
        const topY = sy(skyTop(S.level)), botY = sy(0), gh = botY - topY;
        const color = ch === "f" ? "#ff9a3d" : "#7dff5e";
        ctx.save();
        ctx.globalAlpha = 0.22; ctx.fillStyle = color; ctx.fillRect(x, topY, T, gh);
        ctx.globalAlpha = 0.9;                          // bright edges
        ctx.fillRect(x, topY, 3, gh); ctx.fillRect(x + T - 3, topY, 3, gh);
        ctx.globalAlpha = 0.5;              // shimmer lines, drifting UP like a rocket
        const t3 = performance.now() / 400;
        for (let k = 0; k < 3; k++) {
          const yy = botY - (((t3 + k / 3) % 1) * gh);
          ctx.fillRect(x + 4, yy, T - 8, 3);
        }
        ctx.globalAlpha = 1; ctx.fillStyle = "#fff";    // wings = fly ;  square = back to a cube
        ctx.font = "bold 22px Trebuchet MS"; ctx.textAlign = "center";
        ctx.fillText(ch === "f" ? "✈" : "■", x + T/2, topY + gh/2 + 8);
        ctx.textAlign = "left";
        ctx.restore();
      } else if (ch === "h" || ch === "g") {
        // a full-height ground gate. Grey ( h ) takes the ground away and leaves
        // a hole to fall through; gold ( g ) puts the ground back.
        const topY = sy(skyTop(S.level)), botY = sy(0), gh = botY - topY;
        const color = ch === "h" ? "#7b839e" : "#c9a227";
        ctx.save();
        ctx.globalAlpha = 0.22; ctx.fillStyle = color; ctx.fillRect(x, topY, T, gh);
        ctx.globalAlpha = 0.9;                          // bright edges
        ctx.fillRect(x, topY, 3, gh); ctx.fillRect(x + T - 3, topY, 3, gh);
        ctx.globalAlpha = 1; ctx.fillStyle = "#fff";    // ✕ = no ground ;  ▬ = ground again
        ctx.font = "bold 22px Trebuchet MS"; ctx.textAlign = "center";
        ctx.fillText(ch === "h" ? "✕" : "▬", x + T/2, topY + gh/2 + 8);
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

  // signs — the words the level maker left for you, on top of everything
  for (const sign of signs) drawSign(ctx, sign.x, sign.y, sign.text);

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
  ctx.restore();   // done with the world (the zoom)
  ctx.restore();   // done with the screen shake — the HUD below is never shaken or zoomed

  // progress bar + coins
  const prog = view.levelProgress();
  document.getElementById("progressFill").style.width = (prog * 100) + "%";
  ctx.fillStyle = "#fff"; ctx.font = "bold 18px Trebuchet MS"; ctx.textAlign = "right";
  ctx.fillText("\u25CF " + coinsGot.size + " / " + totalCoins, W - 16, 30);
  // Your purse, just under the coin counter.
  ctx.fillStyle = CONFIG.COIN_HUD_COLOR;
  ctx.fillText("\uD83D\uDCB0 " + coinBalance, W - 16, 52);
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
    // What the server actually paid us for this run. It can be fewer than
    // we collected — coins only ever pay the first time.
    if (runCoinsEarned > 0) {
      ctx.fillStyle = CONFIG.COIN_COLOR; ctx.font = "bold 28px Trebuchet MS";
      ctx.fillText("+" + runCoinsEarned + " coins!", W/2, y); y += 34;
      ctx.fillStyle = "#fff"; ctx.font = "bold 22px Trebuchet MS";
    }
    // This level was played as its own character, and now that cube is yours
    // to wear whenever you like.
    if (view.runUnlocked) {
      ctx.fillStyle = "#ff9ae0"; ctx.font = "bold 26px Trebuchet MS";
      ctx.fillText("New look: " + view.runUnlocked.name + "! 🎭", W/2, y); y += 34;
      ctx.fillStyle = "#fff"; ctx.font = "bold 22px Trebuchet MS";
    }
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
