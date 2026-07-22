// ============================================================
// menu.js — the list of levels, and everything you do to one.
// ============================================================
// This is the front page: which levels there are, who made them, how
// far everybody got, and the buttons for playing, starring, editing,
// publishing and putting a prize up.
//
// It has two tabs:
//
//   NEW LEVELS   everything anybody has published. This is the shared
//                list — the point of the whole game.
//   MY LEVELS    yours, including the DRAFTS nobody else can see. This
//                is where a level lives while you're still building it.
//
// ...and four ways to sort, because "which one should I play?" has
// more than one right answer: the curated order, the newest, the most
// liked, or the ones with a prize on them.
//
// main.js hands it what it needs through initMenu(); it never reaches
// into main.js's own variables.

import { apiGet, apiWrite, apiDelete, askConfirm } from "../api.js";
import { publishFee, bountyBounds, balance, ownLook } from "../economy.js";
import { showToast } from "./toast.js";

// Filled in by initMenu().
let deps = {};

// Every level we're allowed to see, straight from the server.
let allLevels = [];

// Which tab is showing, and how the list is sorted.
let tab = "new";          // "new" | "mine"
let sortBy = "newest";    // "order" | "newest" | "stars" | "bounty"

const listEl = document.getElementById("levelList");

/* ================================================================
   =========================  SET UP  =============================
   ================================================================ */
export function initMenu(options) {
  deps = options;   // { S, showScreen, startLevel, openLevelForEdit,
                    //   leaderboardFor, myBest, isMyScore, may, currentAccount,
                    //   openAdventures, onCoinsChanged }
  wireChips("menuTabs", value => showTab(value, sortBy));
  wireChips("menuSorts", value => showTab(tab, value));
  document.getElementById("adventuresBtn").onclick = () => deps.openAdventures();
}

/* ----------------------------------------------------------------
   SHOW A TAB, SORTED A PARTICULAR WAY. The pill buttons call this, and
   so does the boot test — so "does every tab still draw?" is a
   question something can actually ask.
   ---------------------------------------------------------------- */
export function showTab(which, sort) {
  tab = which || "new";
  sortBy = sort || "newest";
  buildMenu();
}

// The little rows of pill buttons at the top of the menu (the tabs and
// the sort choices). Both work the same way: tap one, it lights up.
//
// Array.from, not a plain for...of: the boot test's pretend browser
// answers every question with a stand-in that isn't a list, and
// Array.from turns that into an empty one instead of throwing.
function chipsIn(row) {
  return Array.from(row.querySelectorAll(".chip") || []);
}
function wireChips(rowId, chosen) {
  const row = document.getElementById(rowId);
  if (!row) return;
  for (const chip of chipsIn(row)) {
    chip.onclick = () => {
      for (const other of chipsIn(row)) other.classList.remove("selected");
      chip.classList.add("selected");
      chosen(chip.dataset.value);
    };
  }
}

/* ================================================================
   ====================  THE LEVELS WE KNOW  ======================
   ================================================================ */

// Everything we can see. main.js uses this for "Play All".
export function levels() { return allLevels; }

// Just the published ones, in the order the server keeps them. That's
// what "Play All" plays — you can't adventure through somebody's draft.
export function listedLevels() {
  return allLevels.filter(L => statusOf(L) === "listed");
}

// One level by its number (the adventures screen asks for these).
export function levelById(id) {
  return allLevels.find(L => Number(L.id) === Number(id)) || null;
}

// Take a fresh list from the server and redraw.
export async function refreshLevels() {
  allLevels = await apiGet("/levels");
  if (deps.onLevelsChanged) deps.onLevelsChanged(allLevels);
  buildMenu();
  return allLevels;
}

// Take a list somebody else already fetched.
export function setLevels(list) {
  allLevels = list || [];
  if (deps.onLevelsChanged) deps.onLevelsChanged(allLevels);
}

// A level from before the lifecycle existed has no status; it was
// already out there for everybody, so it counts as published.
function statusOf(L) { return L.status || "listed"; }

function isMine(L) {
  const me = deps.currentAccount();
  return !!me && Number(L.ownerId) === Number(me.id);
}

/* ================================================================
   ==============  WHICH LEVELS, AND IN WHAT ORDER  ===============
   ================================================================ */
function levelsToShow() {
  const chosen = tab === "mine"
    ? allLevels.filter(isMine)                        // yours, drafts and all
    : allLevels.filter(L => statusOf(L) === "listed"); // everybody's published ones

  const copy = [...chosen];
  // "order" is the curated order the server keeps them in, which is the
  // order they already arrived in — so there is nothing to do for that one.
  if (sortBy === "newest") {
    copy.sort((a, b) => whenMade(b) - whenMade(a));
  } else if (sortBy === "stars") {
    // Most liked first, and the newest of two equally-liked ones first.
    copy.sort((a, b) => (b.starCount || 0) - (a.starCount || 0) || whenMade(b) - whenMade(a));
  } else if (sortBy === "bounty") {
    // Levels with a prize still to be won, biggest prize first.
    copy.sort((a, b) => prizeOf(b) - prizeOf(a) || whenMade(b) - whenMade(a));
  }
  return copy;
}

function whenMade(L) {
  return Date.parse(L.publishedAt || L.createdAt || L.updatedAt || 0) || 0;
}
// How much a level is offering right now. 0 = no prize left to win.
function prizeOf(L) {
  const b = L.bounty;
  return (b && b.slotsLeft > 0) ? Number(b.amountPer) : 0;
}

/* ================================================================
   ======================  DRAWING THE LIST  ======================
   ================================================================ */
export function buildMenu(fromMain) {
  // main.js used to pass the levels straight in; keep taking them that
  // way so nothing has to know which of us owns the list.
  if (Array.isArray(fromMain)) setLevels(fromMain);

  // The ▲▼ buttons only make sense while the list is in ITS OWN order.
  // Sorted by stars, "move this one up" would mean nothing.
  const canReorder = deps.may("level.reorder") && sortBy === "order" && tab === "new";

  const showing = levelsToShow();
  listEl.innerHTML = "";
  if (!showing.length) {
    listEl.innerHTML = '<div class="menuEmpty">' + emptyMessage() + "</div>";
    return;
  }

  showing.forEach((L, i) => listEl.appendChild(levelCard(L, i, showing, canReorder)));
}

function emptyMessage() {
  if (tab === "mine") return "You haven't made a level yet — tap ✎ Level Editor!";
  return "No levels published yet. Make one, then tap ⇧ Publish to share it!";
}

// One row: a big Play button with everything worth knowing on it, then
// the buttons you're allowed to use.
function levelCard(L, i, showing, canReorder) {
  const item = document.createElement("div");
  item.className = "levelItem";

  const play = document.createElement("button");
  play.className = "btn green";
  const title = (i + 1) + ". " + L.name + (L.author ? "  — " + L.author : "");
  play.innerHTML =
    "<div>" + escapeHtml(title) + "</div>" +
    statusChip(L) + lookLine(L) + bountyLine(L) +
    '<div class="levelScore">' + scoreLine(L.id) + "</div>";
  play.onclick = () => playLevel(L, i);
  item.append(play);

  item.append(starButton(L));

  // The 📊 opens everybody's best on this level.
  const board = document.createElement("button");
  board.className = "btn small"; board.textContent = "📊"; board.title = "High scores";
  board.onclick = () => openScores(L);
  item.append(board);

  // The rest only appear if you're allowed to use them. (The server
  // checks again for real — this is just tidiness, so kids don't tap
  // things that were only ever going to say no.)
  if (canReorder) {
    const up = smallBtn("▲", "Move up", () => moveLevel(showing, i, -1));
    up.disabled = (i === 0);
    const down = smallBtn("▼", "Move down", () => moveLevel(showing, i, +1));
    down.disabled = (i === showing.length - 1);
    item.append(up, down);
  }

  // Your own draft: the one button that costs coins (unless you're a
  // grown-up looking after the game, and then it doesn't).
  if (statusOf(L) === "draft" && deps.may("level.publish", L)) {
    const fee = publishesFree() ? 0 : publishFee();
    const publish = smallBtn(fee ? "⇧ Publish — " + fee : "⇧ Publish",
      "Show it to everybody", () => publishLevel(L));
    publish.classList.add("green");
    if (fee && balance() < fee) publish.classList.add("cantAfford");
    item.append(publish);
  }

  // Your own published level: put a prize on it.
  if (statusOf(L) === "listed" && deps.may("level.bounty", L) && !prizeOf(L)) {
    item.append(smallBtn("💰", "Put up a prize", () => openBountyBox(L)));
  }

  // A curator can take a level off the list, or put it back. Only those
  // two states have a button: a DRAFT isn't on the list in the first
  // place, so there is nothing to take it off.
  if (deps.may("level.hide") && statusOf(L) !== "draft") {
    const hidden = statusOf(L) === "hidden";
    item.append(smallBtn(hidden ? "👁" : "🚫",
      hidden ? "Put it back on the list" : "Take it off the list",
      () => setHidden(L, !hidden)));
  }

  if (deps.may("level.edit", L)) {
    item.append(smallBtn("✎", "Edit", () => deps.openLevelForEdit(L)));
  }
  if (deps.may("level.delete", L)) {
    const del = smallBtn("🗑", "Delete", () => deleteLevel(L));
    del.classList.add("pink");
    item.append(del);
  }
  return item;
}

function smallBtn(label, title, onClick) {
  const b = document.createElement("button");
  b.className = "btn small";
  b.textContent = label;
  b.title = title;
  b.onclick = onClick;
  return b;
}

// Where in its life this level is. Only shown when it isn't simply
// published — a normal level says nothing, because there's nothing to say.
function statusChip(L) {
  const status = statusOf(L);
  if (status === "draft") {
    return '<div class="levelChip draft">✎ Draft — only you can see this</div>';
  }
  if (status === "hidden") {
    // "takenDown", not "hidden": the class called `hidden` means "don't
    // draw this" everywhere else on the page, and it would swallow the
    // very line explaining that the level is hidden. 🙃
    return '<div class="levelChip takenDown">🚫 Hidden by a curator</div>';
  }
  return "";
}

// Levels played as their own character say so, so you can see the prize
// before you start. 🔒 until you've won it, 🎭 once it's yours.
function lookLine(L) {
  if (!L.reward || !L.reward.name) return "";
  const got = ownLook(L.reward.skin);
  return '<div class="levelLook">' + (got ? "🎭 " : "🔒 ") + escapeHtml(L.reward.name) + "</div>";
}

// "💰 20 × 2 left" — there's a prize on this one, go and get it.
function bountyLine(L) {
  const b = L.bounty;
  if (!b || !(b.slotsLeft > 0)) return "";
  return '<div class="levelBounty">💰 ' + b.amountPer + " × " + b.slotsLeft + " left</div>";
}

// The little grey line under a level's name: the top score and your own best.
function scoreLine(levelId) {
  const top = deps.leaderboardFor(levelId)[0];
  if (!top) return "No scores yet — be the first!";
  let line = "🏆 " + top.percent + "% " + escapeHtml(top.player);
  const mine = deps.myBest(levelId);
  if (mine != null) line += "   ·   you " + mine + "%";
  return line;
}

// Keep names safe to drop straight into a button's HTML.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ================================================================
   ==========================  STARS  =============================
   ================================================================
   One star each, and tapping again takes it back. Stars are worth no
   coins at all — they're just a way of saying "this one's good". */
function starButton(L) {
  const b = document.createElement("button");
  b.className = "btn small starBtn" + (L.starredByMe ? " starred" : "");
  b.textContent = (L.starredByMe ? "⭐ " : "☆ ") + (L.starCount || 0);
  b.title = L.starredByMe ? "You liked this one" : "I like this one!";
  b.onclick = async () => {
    b.disabled = true;
    try {
      const answer = await apiWrite("POST", "/stars/" + L.id);
      // Change our own copy too, so the next redraw already knows. We do
      // NOT redraw the whole list here even when it's sorted by stars:
      // having the row you just tapped jump somewhere else under your
      // finger is horrible. It moves the next time the list is built.
      L.starredByMe = answer.starred;
      L.starCount = answer.starCount;
      b.className = "btn small starBtn" + (answer.starred ? " starred" : "");
      b.textContent = (answer.starred ? "⭐ " : "☆ ") + answer.starCount;
    } catch (e) {
      showToast(e.message);
    }
    b.disabled = false;
  };
  return b;
}

/* ================================================================
   =======================  PLAYING ONE  ==========================
   ================================================================ */
function playLevel(L, i) {
  deps.S.campaign = false;
  deps.startLevel(L, i);
}

/* ================================================================
   ==================  PUBLISHING AND HIDING  =====================
   ================================================================ */
// Does publishing cost ME anything? It costs the kids — that's the point
// of it — but not a grown-up looking after the game. The server decides
// for real; this is only so the button can say the right thing.
function publishesFree() { return deps.may("level.publishFree"); }

async function publishLevel(L) {
  const fee = publishesFree() ? 0 : publishFee();
  const ok = await askConfirm(
    "Publish \"" + L.name + "\" so everybody can play it?" +
    (fee ? " That costs " + fee + " coins." : ""));
  if (!ok) return;
  try {
    const answer = await apiWrite("POST", "/levels/" + L.id + "/publish");
    if (deps.onCoinsChanged) deps.onCoinsChanged(answer);
    await refreshLevels();
    showToast("Published! Everybody can play it now. 🎉");
  } catch (e) {
    showToast(e.message);     // "you need 6 more coins" and friends
  }
}

async function setHidden(L, hide) {
  if (hide) {
    const ok = await askConfirm("Take \"" + L.name + "\" off the list? " +
      "It isn't deleted — you can put it back.");
    if (!ok) return;
  }
  try {
    await apiWrite("POST", "/levels/" + L.id + (hide ? "/hide" : "/unhide"));
    await refreshLevels();
    showToast(hide ? "Taken off the list." : "Back on the list!");
  } catch (e) { showToast(e.message); }
}

/* ================================================================
   ========================  BOUNTIES  ============================
   ================================================================
   "First three people to beat my level get 20 coins each." You pay for
   all three the moment you tap it, so the prize is really there — and
   that's also why you can't take it back afterwards. */
const bountyBox = document.getElementById("bountyBox");
let bountyLevel = null;

function openBountyBox(L) {
  bountyLevel = L;
  const { min, max, slots } = bountyBounds();
  const slider = document.getElementById("bountySlider");
  slider.min = min; slider.max = max; slider.step = 5;
  slider.value = Math.min(max, Math.max(min, 20));
  document.getElementById("bountyTitle").textContent = "💰 A prize for " + L.name;
  showBountyPrice();
  bountyBox.classList.remove("hidden");
  slider.oninput = showBountyPrice;
}
function showBountyPrice() {
  const each = Number(document.getElementById("bountySlider").value);
  const { slots } = bountyBounds();
  const total = each * slots;
  document.getElementById("bountyPrice").textContent =
    slots + " prizes of " + each + " = " + total + " coins";
  const btn = document.getElementById("bountyOkBtn");
  const canAfford = balance() >= total;
  btn.disabled = !canAfford;
  btn.textContent = canAfford ? "Put it up" : "Need " + (total - balance()) + " more";
}
document.getElementById("bountyCancelBtn").onclick = () => bountyBox.classList.add("hidden");
document.getElementById("bountyOkBtn").onclick = async () => {
  const amountPer = Number(document.getElementById("bountySlider").value);
  const L = bountyLevel;
  bountyBox.classList.add("hidden");
  if (!L) return;
  try {
    const answer = await apiWrite("POST", "/levels/" + L.id + "/bounty", { amountPer });
    if (deps.onCoinsChanged) deps.onCoinsChanged(answer);
    await refreshLevels();
    showToast("Prize is up! " + bountyBounds().slots + " × " + amountPer + " coins. 💰");
  } catch (e) { showToast(e.message); }
};

/* ================================================================
   ===================  REORDER AND DELETE  =======================
   ================================================================ */
/* ----------------------------------------------------------------
   Move a level earlier (▲) or later (▼) and save the new order to the
   server so everyone sees it. Only ever offered from the "Order" sort,
   so the position you can see really is the position it has.

   We swap inside the list that is ON SCREEN and send exactly those ids.
   The list we can see is never the whole list — drafts and hidden
   levels aren't in it — so swapping inside the full one would move the
   wrong level, and sending the full one would send levels we can't see.
   The server slots these levels back into the places they already
   occupy and leaves everything else alone.
   ---------------------------------------------------------------- */
async function moveLevel(showing, at, dir) {
  const to = at + dir;
  if (to < 0 || to >= showing.length) return;
  const order = showing.map(L => L.id);
  [order[at], order[to]] = [order[to], order[at]];
  try {
    await apiWrite("PUT", "/levels/order", { order });
    await refreshLevels();
  } catch (e) { showToast(e.message); }
}

// Ask "are you sure?" then delete the level from the server.
async function deleteLevel(L) {
  const ok = await askConfirm("Delete \"" + L.name + "\"? This can't be undone here.");
  if (!ok) return;
  try {
    await apiDelete("/levels/" + L.id);
    await refreshLevels();
    showToast("Deleted.");
  } catch (e) { showToast(e.message); }
}

/* ================================================================
   =====================  THE 📊 SCORE LIST  ======================
   ================================================================ */
export function openScores(L) {
  document.getElementById("scoresTitle").textContent = "🏆 " + L.name;
  const el = document.getElementById("scoresList");
  const board = deps.leaderboardFor(L.id);
  if (!board.length) {
    el.innerHTML = '<div class="scoreRow">No scores yet — go play it!</div>';
  } else {
    el.innerHTML = board.map((s, i) => {
      const mine = deps.isMyScore(s) ? " me" : "";
      return '<div class="scoreRow' + mine + '">' +
        "<span>" + (i + 1) + ". " + escapeHtml(s.player) + "</span>" +
        "<span>" + s.percent + "%</span></div>";
    }).join("");
  }
  document.getElementById("scoresBox").classList.remove("hidden");
}
document.getElementById("scoresCloseBtn").onclick =
  () => document.getElementById("scoresBox").classList.add("hidden");
