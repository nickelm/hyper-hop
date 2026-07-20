// ============================================================
// routes/auth.js — logging in and out, and making an account.
// ============================================================
// The login screen asks for the list of players (so it can show
// everyone's cube), then sends a name and a password here. If they
// match, we hand the browser a secret cookie and it stays logged in
// for 90 days — even if the server is restarted.

"use strict";

const express = require("express");
const {
  ACCOUNTS_FILE, readJson, updateJson, nextId,
} = require("../lib/storage");
const { validateName, cleanSkin } = require("../lib/validate");
const { hashPassword, checkPassword, MIN_PASSWORD } = require("../lib/passwords");
const { createSession, destroySession, destroyAllForAccount } = require("../lib/sessions");
const {
  SESSION_COOKIE, NINETY_DAYS, readCookie, setCookie, clearCookie,
} = require("../lib/cookies");
const { notFrozen, loadAccount, publicAccount, meView } = require("../lib/auth");
const { getPrices } = require("../lib/prices");

const router = express.Router();

/* ================================================================
   ==============  THE "TOO MANY TRIES" DOORBELL  =================
   ================================================================
   Five wrong guesses and that name is locked for a minute. Long
   enough to stop a computer guessing its way in, short enough that a
   typo isn't a disaster. We keep this in the server's memory only —
   it forgets when the server restarts, and it never writes a file. */
const LOCK_AFTER = 5;
const LOCK_SECONDS = 60;
const wrongTries = new Map();       // lowercase name -> { count, until }

function lockedFor(nameKey) {
  const row = wrongTries.get(nameKey);
  if (!row || !row.until) return 0;
  const secondsLeft = Math.ceil((row.until - Date.now()) / 1000);
  if (secondsLeft <= 0) { wrongTries.delete(nameKey); return 0; }
  return secondsLeft;
}
function noteWrongTry(nameKey) {
  const row = wrongTries.get(nameKey) || { count: 0, until: 0 };
  row.count++;
  if (row.count >= LOCK_AFTER) { row.until = Date.now() + LOCK_SECONDS * 1000; row.count = 0; }
  wrongTries.set(nameKey, row);
}
function forgetWrongTries(nameKey) { wrongTries.delete(nameKey); }

// Find a player by name, ignoring capital letters.
function findByName(accounts, name) {
  const key = String(name == null ? "" : name).trim().toLowerCase();
  if (!key) return null;
  return accounts.find(a => String(a.name).toLowerCase() === key) || null;
}

// Log somebody in: make a session and put the cookie on the answer.
function startLogin(req, res, account) {
  const token = createSession(account.id);
  setCookie(res, req, SESSION_COOKIE, token, NINETY_DAYS);
  res.json(meView(account));
}

/* ---------------- Who am I? ----------------
   Answers with your player (or null if nobody is logged in) — and
   always with a cheerful 200, never an error. The game asks this on
   every page load, and "nobody is logged in yet" is a perfectly
   normal answer, not a problem. */
router.get("/me", loadAccount, (req, res) => {
  res.json(meView(req.account));
});

/* ---------------- Everybody's names + cubes ----------------
   The login screen needs this to draw a button per player. It goes
   through publicAccount, so no passwords ever leave the server. */
router.get("/accounts", (req, res) => {
  res.json(readJson(ACCOUNTS_FILE).map(publicAccount));
});

/* ---------------- Log in ----------------
   No `notFrozen` here on purpose: even when editing is frozen you can
   still come in and play. (Logging in does write sessions.json — the
   one write allowed while frozen.) */
router.post("/login", loadAccount, (req, res) => {
  const { name, password } = req.body || {};
  const nameKey = String(name == null ? "" : name).trim().toLowerCase();

  const waitSeconds = lockedFor(nameKey);
  if (waitSeconds) {
    return res.status(429).json({
      error: "Too many tries! Wait " + waitSeconds + " seconds and have another go. ⏳",
    });
  }

  const account = findByName(readJson(ACCOUNTS_FILE), name);

  // An account nobody has claimed yet has no password. Tell the game
  // so it can offer "pick your password" instead of "wrong password".
  if (account && account.passwordHash == null) {
    return res.status(409).json({
      error: "Nobody has picked a password for " + account.name + " yet.",
      needsPassword: true,
      name: account.name,
    });
  }

  // We say exactly the same thing whether the NAME was wrong or the
  // PASSWORD was — otherwise a guesser learns which names exist.
  if (!account || !checkPassword(password, account.passwordHash)) {
    noteWrongTry(nameKey);
    return res.status(401).json({ error: "That password doesn't match — try again! 🤔" });
  }

  forgetWrongTries(nameKey);
  startLogin(req, res, account);
});

/* ---------------- Claim an account that has no password yet ----------------
   This is how the kids who were already in the game (from before
   there were passwords) make their old name theirs. */
router.post("/set-password", notFrozen, (req, res) => {
  const { name, password } = req.body || {};
  let hash;
  try { hash = hashPassword(password); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  let claimed;
  try {
    claimed = updateJson(ACCOUNTS_FILE, accounts => {
      const account = findByName(accounts, name);
      if (!account) throw new Error("There's nobody called that.");
      // Already has one? Then this is somebody else trying to take it.
      if (account.passwordHash != null) {
        throw new Error("That name already has a password. Tap it and log in! 🙂");
      }
      account.passwordHash = hash;
      account.updatedAt = new Date().toISOString();
      return account;
    });
  } catch (e) { return res.status(400).json({ error: e.message }); }

  forgetWrongTries(String(name).trim().toLowerCase());
  destroyAllForAccount(claimed.id);       // start fresh on every tablet
  startLogin(req, res, claimed);
});

/* ---------------- Make a brand-new player ----------------
   No login needed — this is how you join. It IS frozen by READ_ONLY,
   because it creates something new. */
router.post("/accounts", notFrozen, (req, res) => {
  const { name, password } = req.body || {};
  let cleanName, hash;
  try {
    cleanName = validateName(name);
    hash = hashPassword(password);
  } catch (e) { return res.status(400).json({ error: e.message }); }

  const prices = getPrices();
  const now = new Date().toISOString();

  let created;
  try {
    created = updateJson(ACCOUNTS_FILE, accounts => {
      // Two players with the same name would be very confusing —
      // whose high score is whose?
      if (findByName(accounts, cleanName)) {
        throw new Error("Somebody already has that name — try another one!");
      }
      const account = {
        id: nextId(accounts),
        name: cleanName,
        passwordHash: hash,
        role: "player",
        extraPerms: [],
        skin: cleanSkin(null),          // the classic green cube, free forever
        coins: prices.startingCoins,
        coinsEarnedTotal: 0,
        collectedCoins: {},
        bountiesPaid: 0,
        createdAt: now,
        updatedAt: now,
      };
      accounts.push(account);
      return account;
    });
  } catch (e) { return res.status(400).json({ error: e.message }); }

  startLogin(req, res, created);
});

/* ---------------- Log out ----------------
   Always cheerful, even if you weren't logged in to start with. */
router.post("/logout", (req, res) => {
  destroySession(readCookie(req, SESSION_COOKIE));
  clearCookie(res, req, SESSION_COOKIE);
  res.json({ ok: true });
});

module.exports = router;
module.exports.MIN_PASSWORD = MIN_PASSWORD;
