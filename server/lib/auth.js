// ============================================================
// auth.js — who are you, and what are you allowed to do?
// ============================================================
// Reading is always open: anybody can look at the levels and the high
// scores. CHANGING something means being logged in, and then being
// allowed to change that particular thing.
//
// THIS IS THE ONLY FILE THAT DECIDES WHO CAN DO WHAT. Every route asks
// `can(...)` here — no route makes up its own mind. If you want to
// change the rules, this is the one place to change them.

"use strict";

const { ACCOUNTS_FILE, readJson } = require("./storage");
const { SESSION_COOKIE, readCookie } = require("./cookies");
const { accountIdForToken } = require("./sessions");
const { looksOf } = require("./looks");

const READ_ONLY = process.env.READ_ONLY === "true";

/* ================================================================
   ====================  WHO CAN DO WHAT  =========================
   ================================================================
   Three jobs. Each one is the job before it, plus a bit more:

     player  makes their own levels, and may change their own stuff
     editor  a player who may also fix ANYBODY's level
     admin   an editor who also runs the world (level order, accounts)

   To change somebody's job, open data/accounts.json in a text editor
   and change their "role" — then restart the server. There's no
   button for it on purpose: it's a grown-up job.
   ================================================================ */
const ROLE_POWERS = {
  player: ["level.create", "level.editOwn", "level.deleteOwn", "me.edit", "run.report"],
};
ROLE_POWERS.editor = [...ROLE_POWERS.player, "level.editAny", "level.deleteAny"];
ROLE_POWERS.admin = [...ROLE_POWERS.editor, "level.reorder", "account.editAny"];

// Everything this player is allowed to do: the powers that come with
// their job, PLUS any extra ones written by hand in their
// "extraPerms" list. (So you can let one kid reorder the levels
// without making them a whole admin.)
function powersOf(account) {
  const fromJob = ROLE_POWERS[account && account.role] || ROLE_POWERS.player;
  const powers = new Set(fromJob);
  for (const extra of (account && account.extraPerms) || []) powers.add(extra);
  return powers;
}

/* ----------------------------------------------------------------
   THE ONE QUESTION: "is this player allowed to do this?"

   `thing` is the level or player being touched, so we can tell
   "my own" from "somebody else's". A level belongs to whoever's id is
   in its ownerId; a player account belongs to itself.

   If you change these rules, change `may()` in public/js/ui/login.js
   too — that one only decides which BUTTONS to show. This one is the
   one that really decides.
   ---------------------------------------------------------------- */
function can(account, action, thing) {
  if (!account) return false;
  const powers = powersOf(account);
  const isMine = !!thing && Number(thing.ownerId) === Number(account.id);

  switch (action) {
    case "level.edit":
      return powers.has("level.editAny") || (powers.has("level.editOwn") && isMine);
    case "level.delete":
      return powers.has("level.deleteAny") || (powers.has("level.deleteOwn") && isMine);
    case "account.edit":
      return powers.has("account.editAny") ||
        (powers.has("me.edit") && !!thing && Number(thing.id) === Number(account.id));
    default:
      return powers.has(action);      // create / reorder / run
  }
}

/* ================================================================
   =========================  THE DOOR  ===========================
   ================================================================ */

// The freeze switch: when READ_ONLY is on, politely refuse every
// change. (Logging in is the one exception — you can still come in
// and look around, you just can't change anything.)
function notFrozen(req, res, next) {
  if (READ_ONLY) {
    return res.status(403).json({ error: "Editing is frozen right now. 🧊" });
  }
  next();
}

// Look at the cookie and work out who is playing. This NEVER says no —
// it just puts the player on req.account (or leaves it null), so that
// reading stays open to everybody, logged in or not.
function loadAccount(req, res, next) {
  req.account = null;
  const id = accountIdForToken(readCookie(req, SESSION_COOKIE));
  if (id != null) {
    req.account = readJson(ACCOUNTS_FILE).find(a => Number(a.id) === Number(id)) || null;
  }
  next();
}

// This one DOES say no: you have to be logged in to get past.
function requireLogin(req, res, next) {
  if (!req.account) {
    return res.status(401).json({ error: "Please log in first — tap your name! 👋" });
  }
  next();
}

// The three doormen every change goes through, in this order.
const guard = [notFrozen, loadAccount, requireLogin];

/* ================================================================
   ==============  WHAT WE SEND BACK TO A TABLET  =================
   ================================================================
   A saved player has a scrambled password in it. These two helpers
   are the ONLY way a player is ever sent to a tablet, so a password
   can never leak out by accident — even if somebody adds a new route
   and forgets to think about it. */

// The safe version of a player that anybody may see.
function publicAccount(a) {
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    skin: a.skin,
    coins: a.coins,
    coinsEarnedTotal: a.coinsEarnedTotal,
    hasPassword: a.passwordHash != null,     // false = nobody has claimed this name yet
  };
}

// The fuller version, only ever sent to YOU: adds which coins you've
// already been paid for, every cube you own, and what you're allowed to do.
// (Your collection of looks is nobody else's business, so it is NOT in
// publicAccount — the login screen only ever needs the cube you're wearing.)
function meView(a) {
  if (!a) return null;
  return {
    ...publicAccount(a),
    collectedCoins: a.collectedCoins || {},
    looks: looksOf(a),
    powers: [...powersOf(a)],
  };
}

module.exports = {
  READ_ONLY, ROLE_POWERS,
  notFrozen, loadAccount, requireLogin, guard,
  can, powersOf, publicAccount, meView,
};
