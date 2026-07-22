// ============================================================
// adventures.js — journeys made of levels.
// ============================================================
// An ADVENTURE is a handful of levels a curator has put in an order,
// with a name on the front. You play them from the start, and you
// can't skip: beat one and the next one unlocks.
//
//     ✓ Bouncy Alley      you've beaten this
//     ▶ Turbo Canyon      this is the one you're on
//     🔒 Frozen Rush       not yet!
//
// The server decides all of that (server/lib/adventures.js) — this
// file just draws it, and refuses to let you tap a padlock. If a
// curator drops a new level into the middle, everybody's ▶ moves back
// to it, and that's exactly what should happen.
//
// A curator (an editor or an admin) also gets the buttons for making
// an adventure, renaming it, and moving levels about inside it.

import { apiGet, apiWrite, apiDelete, askConfirm } from "../api.js";
import { drawPlayer, normalizeSkin } from "../game/player.js";
import { showToast } from "./toast.js";

let deps = {};
let adventures = [];
let openId = null;            // which adventure we're looking inside, or null

const listView = () => document.getElementById("adventureList");
const oneView = () => document.getElementById("adventureOne");

export function initAdventures(options) {
  deps = options;   // { S, showScreen, playLevel, may, levelById, listedLevels, backToMenu }
  document.getElementById("adventureBackBtn").onclick = () => {
    if (openId != null) { openId = null; draw(); }     // out of one, back to the list
    else deps.backToMenu();
  };
  document.getElementById("newAdventureBtn").onclick = () => makeAdventure();
}

/* ================================================================
   =======================  OPENING UP  ===========================
   ================================================================ */
// Open the adventures screen. With an id, go straight back INSIDE that
// one — which is what coming back from playing one of its levels should
// do, rather than dumping you at the top and making you find it again.
export async function openAdventures(id) {
  openId = (id != null) ? id : null;
  deps.S.screen = "adventures";
  deps.showScreen("adventureScreen");
  await refresh();
}

export async function refresh() {
  try {
    adventures = await apiGet("/adventures");
  } catch (e) {
    adventures = [];
    showToast("Can't reach the server.");
  }
  draw();
}

function current() {
  return adventures.find(a => Number(a.id) === Number(openId)) || null;
}

function draw() {
  const inside = current();
  listView().classList.toggle("hidden", !!inside);
  oneView().classList.toggle("hidden", !inside);
  document.getElementById("newAdventureBtn").classList
    .toggle("hidden", !!inside || !deps.may("adventure.manage"));
  document.getElementById("adventureTitle").textContent = inside ? inside.name : "🗺 Adventures";
  if (inside) drawOne(inside); else drawList();
}

/* ================================================================
   ===================  THE LIST OF ADVENTURES  ===================
   ================================================================ */
function drawList() {
  const el = listView();
  el.innerHTML = "";
  if (!adventures.length) {
    el.innerHTML = '<div class="menuEmpty">No adventures yet.' +
      (deps.may("adventure.manage") ? " Tap ✚ New adventure to make one!" : "") + "</div>";
    return;
  }
  for (const a of adventures) {
    const row = document.createElement("div");
    row.className = "levelItem";

    const open = document.createElement("button");
    open.className = "btn green";
    open.innerHTML = "<div>" + escapeHtml(a.name) + "</div>" +
      '<div class="levelScore">' + progressLine(a) + "</div>";
    open.onclick = () => { openId = a.id; draw(); };
    row.append(open);

    if (deps.may("adventure.manage")) {
      row.append(small("✎", "Rename", () => renameAdventure(a)));
      const del = small("🗑", "Delete", () => deleteAdventure(a));
      del.classList.add("pink");
      row.append(del);
    }
    el.append(row);
  }
}

// "3 / 5 levels — next up: Turbo Canyon"
function progressLine(a) {
  const total = a.total || 0;
  let line = a.score + " / " + total + (total === 1 ? " level" : " levels");
  const next = nextUp(a);
  if (next) line += "   ·   next: " + escapeHtml(next.name);
  else if (total && a.score >= total) line += "   ·   all done! 🎉";
  return line;
}

// The level you're allowed to play next, or null if there isn't one.
function nextUp(a) {
  const id = (a.playableIds || [])[a.frontier];
  return id == null ? null : deps.levelById(id);
}

/* ================================================================
   ==================  INSIDE ONE ADVENTURE  ======================
   ================================================================ */
function drawOne(a) {
  const el = oneView();
  el.innerHTML = "";

  const curator = deps.may("adventure.manage");
  const done = new Set((a.completed || []).map(Number));
  const open = a.playableIds || [];

  (a.levelIds || []).forEach((id, i) => {
    const level = deps.levelById(id);
    const row = document.createElement("div");
    row.className = "levelItem";

    // Where is this level in the "you may play up to here" line? A level
    // a curator has hidden isn't in that line at all.
    const place = open.indexOf(Number(id));
    const beaten = done.has(Number(id));
    const playable = place !== -1 && place <= a.frontier;
    const gone = place === -1;

    const btn = document.createElement("button");
    btn.className = "btn " + (beaten ? "green" : playable ? "green frontier" : "locked");
    const mark = beaten ? "✓" : gone ? "…" : playable ? "▶" : "🔒";
    const name = level ? level.name : "(a level that went away)";
    btn.innerHTML = "<div>" + mark + " " + (i + 1) + ". " + escapeHtml(name) + "</div>" +
      (gone ? '<div class="levelScore">not available just now — skipped</div>' :
       playable ? "" : '<div class="levelScore">beat the one before it first</div>');
    btn.disabled = !playable || !level;
    btn.onclick = () => deps.playLevel(level, { adventureId: a.id });
    row.append(btn);

    if (curator) {
      const up = small("▲", "Move up", () => moveLevel(a, i, -1));
      up.disabled = i === 0;
      const down = small("▼", "Move down", () => moveLevel(a, i, +1));
      down.disabled = i === (a.levelIds.length - 1);
      const out = small("➖", "Take it out", () => removeLevel(a, id));
      out.classList.add("pink");
      row.append(up, down, out);
    }
    el.append(row);
  });

  if (curator) {
    const add = document.createElement("button");
    add.className = "btn small";
    add.textContent = "➕ Add a level";
    add.onclick = () => openAddLevel(a);
    el.append(add);
  }

  // Everybody, ranked. Drawn after the levels so it reads as a footer.
  const board = document.createElement("div");
  board.id = "adventureBoard";
  board.innerHTML = '<div class="boardRow">Loading…</div>';
  el.append(board);
  drawBoard(a, board);
}

/* ================================================================
   ======================  THE SCORE BOARD  =======================
   ================================================================
   Ranked by how many of this adventure's levels each person has
   beaten. Equal scores SHARE a place — if two people have both done
   four, they are both 2nd and the next one is 4th. Nobody is pushed
   down for being just as good as somebody else. */
async function drawBoard(a, into) {
  let answer;
  try { answer = await apiGet("/adventures/" + a.id + "/board"); }
  catch (e) { into.innerHTML = '<div class="boardRow">Can\'t reach the server.</div>'; return; }

  into.innerHTML = '<div class="boardTitle">🏆 How everybody is doing</div>';
  if (!answer.board.length) {
    into.innerHTML += '<div class="boardRow">Nobody has started yet — be the first!</div>';
    return;
  }
  for (const row of answer.board) {
    const line = document.createElement("div");
    line.className = "boardRow" + (row.rank <= 3 ? " medal" + row.rank : "");
    const rank = document.createElement("span");
    rank.textContent = ["🥇", "🥈", "🥉"][row.rank - 1] || row.rank + ".";
    const cube = document.createElement("canvas");
    cube.width = 36; cube.height = 36;
    const name = document.createElement("span");
    name.className = "bName"; name.textContent = row.name;
    const score = document.createElement("span");
    score.className = "bCoins";
    score.textContent = row.score + " / " + row.total + " levels";
    line.append(rank, cube, name, score);
    into.append(line);
    // After it's in the page, so the canvas already has its size.
    const c = cube.getContext("2d");
    drawPlayer(c, cube.width / 2, cube.height / 2, 0, normalizeSkin(row.skin), cube.width * 0.62);
  }
}

/* ================================================================
   =====================  A CURATOR'S JOBS  =======================
   ================================================================ */
async function makeAdventure() {
  const name = await askText("✚ What's this adventure called?", "");
  if (!name) return;
  try {
    await apiWrite("POST", "/adventures", { name, levelIds: [] });
    await refresh();
    showToast("Made it! Now add some levels.");
  } catch (e) { showToast(e.message); }
}

async function renameAdventure(a) {
  const name = await askText("✎ What should it be called?", a.name);
  if (!name) return;
  try {
    await apiWrite("PUT", "/adventures/" + a.id, { name });
    await refresh();
  } catch (e) { showToast(e.message); }
}

async function deleteAdventure(a) {
  const ok = await askConfirm("Delete the adventure \"" + a.name + "\"? " +
    "The levels themselves are not deleted.");
  if (!ok) return;
  try {
    await apiDelete("/adventures/" + a.id);
    openId = null;
    await refresh();
    showToast("Deleted.");
  } catch (e) { showToast(e.message); }
}

// Moving a level inside an adventure is just sending the ids in a
// different order — the server works everything else out from that.
async function moveLevel(a, at, dir) {
  const ids = [...a.levelIds];
  const to = at + dir;
  if (to < 0 || to >= ids.length) return;
  [ids[at], ids[to]] = [ids[to], ids[at]];
  await saveLevelIds(a, ids);
}

async function removeLevel(a, id) {
  await saveLevelIds(a, a.levelIds.filter(x => Number(x) !== Number(id)));
}

async function saveLevelIds(a, levelIds) {
  try {
    await apiWrite("PUT", "/adventures/" + a.id, { levelIds });
    await refresh();
  } catch (e) { showToast(e.message); }
}

/* ---------------- "Add a level" ----------------
   Only PUBLISHED levels can go in — an adventure is something
   everybody plays, so it can't be built out of somebody's drafts. */
function openAddLevel(a) {
  const box = document.getElementById("addLevelBox");
  const list = document.getElementById("addLevelList");
  const already = new Set((a.levelIds || []).map(Number));
  const choices = deps.listedLevels().filter(L => !already.has(Number(L.id)));

  list.innerHTML = "";
  if (!choices.length) {
    list.innerHTML = '<div class="scoreRow">Every published level is already in here!</div>';
  }
  for (const L of choices) {
    const b = document.createElement("button");
    b.className = "btn small";
    b.textContent = L.name + (L.author ? " — " + L.author : "");
    b.onclick = async () => {
      box.classList.add("hidden");
      await saveLevelIds(a, [...(a.levelIds || []), L.id]);
    };
    list.append(b);
  }
  box.classList.remove("hidden");
}
document.getElementById("addLevelCloseBtn").onclick =
  () => document.getElementById("addLevelBox").classList.add("hidden");

/* ---------------- A little "type something" pop-up ----------------
   Same shape as the others. It only ever opens because somebody
   TAPPED something, never on its own. */
function askText(message, startWith) {
  return new Promise(resolve => {
    const box = document.getElementById("adventureNameBox");
    const input = document.getElementById("adventureNameInput");
    const okBtn = document.getElementById("adventureNameOkBtn");
    const cancelBtn = document.getElementById("adventureNameCancelBtn");
    document.getElementById("adventureNameMsg").textContent = message;
    input.value = startWith || "";
    box.classList.remove("hidden");
    setTimeout(() => input.focus(), 50);
    function done(value) {
      box.classList.add("hidden");
      okBtn.onclick = cancelBtn.onclick = input.onkeydown = null;
      resolve(value && value.trim() ? value.trim() : null);
    }
    okBtn.onclick = () => done(input.value);
    cancelBtn.onclick = () => done(null);
    input.onkeydown = e => { if (e.key === "Enter") done(input.value); };
  });
}

function small(label, title, onClick) {
  const b = document.createElement("button");
  b.className = "btn small";
  b.textContent = label; b.title = title; b.onclick = onClick;
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ----------------------------------------------------------------
   AFTER YOU WIN ONE. main.js asks us what to do next: the level after
   this one in the adventure, or nothing if that was the last.
   ---------------------------------------------------------------- */
export async function nextInAdventure(adventureId) {
  await refresh();                     // our frontier just moved
  const a = adventures.find(x => Number(x.id) === Number(adventureId));
  if (!a) return null;
  const next = nextUp(a);
  return next ? { level: next, adventureId: a.id } : null;
}
