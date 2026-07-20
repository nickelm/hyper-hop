// ============================================================
// login.js — the "who are you?" screen.
// ============================================================
// The first thing you see. It shows a cube button for every player;
// you tap yours and type your password. If nobody has claimed that
// name yet (everybody who played before passwords existed), it asks
// you to pick one instead.
//
// It also answers "which buttons should this player even see?" — see
// may() at the bottom. That's only about BUTTONS: the server checks
// everything again for real.

import { apiGet, apiPost, setLoggedOutHandler } from "../api.js";
import { drawPlayer, normalizeSkin } from "../game/player.js";
import { showToast } from "./toast.js";

// The ONE thing we keep on the tablet itself: which name to highlight
// on the login screen next time. It's a convenience, nothing more —
// no password, no coins, nothing the game trusts. (See CLAUDE.md.)
const LAST_ACCOUNT_KEY = "hh_last_account";

function rememberLastAccount(name) {
  try { localStorage.setItem(LAST_ACCOUNT_KEY, name || ""); } catch (e) {}
}
function lastAccountName() {
  try { return localStorage.getItem(LAST_ACCOUNT_KEY) || ""; } catch (e) { return ""; }
}

// Who is playing right now, as the server told us. null = nobody yet.
let me = null;
let accounts = [];
let deps = {};

export function initLogin(options) {
  deps = options;      // { showScreen, onLoggedIn, onLoggedOut }
  // If any request anywhere is told "I don't know you", come back here.
  setLoggedOutHandler(() => { me = null; showLogin(); });
}

export function currentAccount() { return me; }

/* ================================================================
   ====================  THE LOGIN SCREEN  ========================
   ================================================================ */

// Show the login screen and (re)fill it with everybody's cubes.
export function showLogin() {
  deps.showScreen("loginScreen");
  buildLoginPicker();
}

// Draw one player's cube into a little canvas button.
function renderCube(canvas, skin) {
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, canvas.width, canvas.height);
  drawPlayer(c, canvas.width / 2, canvas.height / 2, 0, normalizeSkin(skin), canvas.width * 0.62);
}

// Build the row of "tap your name" buttons.
export function buildLoginPicker() {
  const row = document.getElementById("accountRow");
  if (!row) return;
  row.innerHTML = "";

  const favourite = lastAccountName().toLowerCase();
  for (const account of accounts) {
    const btn = document.createElement("button");
    btn.className = "profileBtn" + (account.name.toLowerCase() === favourite ? " selected" : "");
    const cv = document.createElement("canvas");
    cv.width = 56; cv.height = 56;
    btn.appendChild(cv);
    renderCube(cv, account.skin);
    const nm = document.createElement("div");
    nm.className = "pName";
    nm.textContent = account.name;
    btn.appendChild(nm);
    // A player nobody has claimed yet gets a little hint.
    if (!account.hasPassword) {
      const hint = document.createElement("div");
      hint.className = "pHint";
      hint.textContent = "tap to claim";
      btn.appendChild(hint);
    }
    btn.onclick = () => tapAccount(account);
    row.appendChild(btn);
  }

  const add = document.createElement("button");
  add.className = "profileBtn add";
  add.innerHTML = "＋<div class='pName'>New player</div>";
  add.onclick = () => newAccount();
  row.appendChild(add);
}

// Fetch everybody's names and cubes, then draw them.
export async function loadAccounts() {
  try { accounts = await apiGet("/accounts"); }
  catch (e) { accounts = []; }
  buildLoginPicker();
}

/* ---------------- The password pop-up ----------------
   Reuses the old PIN box — same shape, new words. It only ever opens
   because somebody TAPPED something, never on its own at start-up. */
function askPassword(message, okLabel) {
  return new Promise(resolve => {
    const box = document.getElementById("passwordBox");
    const input = document.getElementById("passwordInput");
    const okBtn = document.getElementById("passwordOkBtn");
    const cancelBtn = document.getElementById("passwordCancelBtn");
    document.getElementById("passwordMsg").textContent = message;
    okBtn.textContent = okLabel || "Log in";
    input.value = "";
    box.classList.remove("hidden");
    setTimeout(() => input.focus(), 50);
    function done(value) {
      box.classList.add("hidden");
      okBtn.onclick = cancelBtn.onclick = input.onkeydown = null;
      resolve(value);
    }
    okBtn.onclick = () => done(input.value || null);
    cancelBtn.onclick = () => done(null);
    input.onkeydown = e => { if (e.key === "Enter") done(input.value || null); };
  });
}

// Ask for a name (making a brand-new player).
function askName(message) {
  return new Promise(resolve => {
    const box = document.getElementById("nameBox");
    const input = document.getElementById("nameInput");
    const okBtn = document.getElementById("nameOkBtn");
    const cancelBtn = document.getElementById("nameCancelBtn");
    document.getElementById("nameMsg").textContent = message;
    input.value = "";
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

// Somebody tapped a cube. Either log them in, or help them claim it.
async function tapAccount(account) {
  if (!account.hasPassword) return claimAccount(account.name);

  const password = await askPassword("Hi " + account.name + "! What's your password?", "Log in");
  if (!password) return;
  try {
    const who = await apiPost("/login", { name: account.name, password });
    finishLogin(who);
  } catch (e) {
    showToast(e.message);
    // A wrong password is worth another go straight away.
    if (!/Too many tries/.test(e.message)) tapAccount(account);
  }
}

// Claim a name that has no password yet (or one we were just told
// needs one).
async function claimAccount(name) {
  const password = await askPassword(
    "Welcome back, " + name + "! Pick a password so this name is yours.", "That's mine!");
  if (!password) return;
  try {
    const who = await apiPost("/set-password", { name, password });
    finishLogin(who);
    showToast("Welcome, " + who.name + "! 🎉");
  } catch (e) { showToast(e.message); }
}

// Make a brand-new player.
async function newAccount() {
  const name = await askName("What should we call you?");
  if (!name) return;
  const password = await askPassword("Nice to meet you, " + name + "! Pick a password.", "Let's play!");
  if (!password) return;
  try {
    const who = await apiPost("/accounts", { name, password });
    finishLogin(who);
    showToast("Welcome, " + who.name + "! 🎉");
  } catch (e) { showToast(e.message); }
}

// We're in. Remember the name for next time and tell main.js.
function finishLogin(who) {
  me = who;
  rememberLastAccount(who.name);
  deps.onLoggedIn(who);
}

// Tell the game who we already are (main.js asks /api/me at start-up).
export function setCurrentAccount(who) { me = who; }

export async function logout() {
  try { await apiPost("/logout"); } catch (e) { /* going anyway */ }
  me = null;
  await loadAccounts();
  deps.onLoggedOut();
  showLogin();
}

/* ================================================================
   ==============  WHICH BUTTONS SHOULD YOU SEE?  =================
   ================================================================
   This mirrors `can()` in server/lib/auth.js. If you change one,
   change the other — but remember the SERVER is the one that really
   decides. Hiding a button is only tidiness; the server says no even
   if somebody finds a way to press it anyway.
   ================================================================ */
export function may(action, thing) {
  if (!me || !me.powers) return false;
  const powers = me.powers;
  const isMine = !!thing && Number(thing.ownerId) === Number(me.id);

  switch (action) {
    case "level.edit":
      return powers.includes("level.editAny") || (powers.includes("level.editOwn") && isMine);
    case "level.delete":
      return powers.includes("level.deleteAny") || (powers.includes("level.deleteOwn") && isMine);
    default:
      return powers.includes(action);
  }
}
