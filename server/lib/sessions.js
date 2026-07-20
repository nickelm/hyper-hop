// ============================================================
// sessions.js — remembering who is logged in.
// ============================================================
// When you log in we invent a long random secret (a "token"), give it
// to your browser as a cookie, and write it down here so we recognise
// it later. Because it lives in data/sessions.json, restarting the
// server does NOT log everybody out.
//
// One careful bit: we do NOT write the secret itself down. We write a
// scrambled fingerprint of it. Backups keep 200 old copies of every
// file, so if the real secrets were in there, an old backup would be
// a pile of working keys forever. A fingerprint can't be turned back
// into the key.

"use strict";

const crypto = require("node:crypto");
const { SESSIONS_FILE, readJson, updateJson, SKIP_SAVE } = require("./storage");

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Turn a secret into a fingerprint: same secret always gives the same
// fingerprint, but you can never work backwards to the secret.
function fingerprint(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Log somebody in: invent a secret, remember its fingerprint, and hand
// the secret back. This is the ONLY moment we ever see it.
function createSession(accountId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  updateJson(SESSIONS_FILE, rows => {
    // Tidy up: throw away any logins that ran out long ago.
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!(rows[i].expiresAt > now)) rows.splice(i, 1);
    }
    rows.push({
      token: fingerprint(token),
      accountId,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + NINETY_DAYS_MS,
    });
  });
  return token;
}

// Whose cookie is this? Answers with a player id, or null if the
// cookie is unknown or too old. This only READS the file (no backup),
// because it runs on every single page load.
function accountIdForToken(token) {
  if (!token) return null;
  const mark = fingerprint(token);
  const row = readJson(SESSIONS_FILE).find(s => s.token === mark);
  return (row && row.expiresAt > Date.now()) ? row.accountId : null;
}

// Log out: forget this one cookie.
function destroySession(token) {
  if (!token) return;
  const mark = fingerprint(token);
  updateJson(SESSIONS_FILE, rows => {
    const at = rows.findIndex(s => s.token === mark);
    if (at === -1) return SKIP_SAVE;
    rows.splice(at, 1);
  });
}

// Log a player out EVERYWHERE — used when they set a new password, so
// an old tablet somebody borrowed can't stay logged in.
function destroyAllForAccount(accountId) {
  updateJson(SESSIONS_FILE, rows => {
    let removed = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (Number(rows[i].accountId) === Number(accountId)) { rows.splice(i, 1); removed++; }
    }
    if (!removed) return SKIP_SAVE;
  });
}

module.exports = { createSession, accountIdForToken, destroySession, destroyAllForAccount };
