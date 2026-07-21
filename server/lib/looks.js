// ============================================================
// looks.js — everybody's collection of cubes ("My Looks").
// ============================================================
// A LOOK is one saved cube: how it looked, and (for a look a level
// gave you) what it's called. Every cube you PAY for is kept here, so
// putting an old favourite back on is free forever — you already
// bought it once.
//
// Looks arrive two ways:
//   from: "shop"   you bought it in the cube editor (no name)
//   from: "level"  a level gave it to you for finishing it ("The Crow")
//
// This is the ONLY place that decides what somebody owns. The shop
// (routes/accounts.js) and the "I finished a level!" route
// (routes/runs.js) both ask here.

"use strict";

// How many looks one player may keep. When it's full the OLDEST
// bought look makes way — a look a level gave you is never thrown
// out to make room, because you had to earn that one.
const MAX_LOOKS = 30;

// The parts of a cube that make it "that look". If two cubes match on
// all of these, they are the same look.
const SKIN_PARTS = ["bodyColor", "outlineColor", "faceColor", "shape", "face", "emoji", "trail", "explosion"];

/* ----------------------------------------------------------------
   ARE THESE THE SAME CUBE? (The tablet has its own copy of this in
   public/js/game/player.js, so the Save button can show "free!"
   before you tap it — but THIS is the one that really decides.)
   ---------------------------------------------------------------- */
function sameSkin(a, b) {
  if (!a || !b) return false;
  return SKIN_PARTS.every(part => a[part] === b[part]);
}

/* ----------------------------------------------------------------
   EVERY LOOK THIS PLAYER OWNS. Somebody who played before looks
   existed has no list yet — they simply own the cube they're wearing,
   so that's what we hand back. Nothing to migrate, no file to fix up.
   ---------------------------------------------------------------- */
function looksOf(account) {
  if (!account) return [];
  if (Array.isArray(account.looks) && account.looks.length) return account.looks;
  return account.skin ? [{ skin: account.skin, name: "", from: "shop" }] : [];
}

// Have you got this cube already?
function ownsLook(account, skin) {
  return looksOf(account).some(look => sameSkin(look.skin, skin));
}

/* ----------------------------------------------------------------
   REMEMBER A NEW LOOK. Changes the account in place (the routes call
   this inside updateJson, so it gets saved with everything else).
   Owning it already does nothing at all.
   ---------------------------------------------------------------- */
function addLook(account, skin, name, from) {
  if (!account || !skin) return false;
  if (ownsLook(account, skin)) return false;
  account.looks = looksOf(account).slice();          // start the list if there wasn't one
  account.looks.push({ skin, name: name || "", from: from || "shop" });
  // Full? Drop the oldest BOUGHT look — but never a prize a level gave
  // you, and never the cube you're wearing right now. (If somehow every
  // look is protected, the oldest one goes; the newest is always kept.)
  while (account.looks.length > MAX_LOOKS) {
    const canGo = look => look.from !== "level" && !sameSkin(look.skin, account.skin);
    const at = account.looks.findIndex(canGo);
    account.looks.splice(at === -1 ? 0 : at, 1);
  }
  return true;
}

module.exports = { MAX_LOOKS, SKIN_PARTS, sameSkin, looksOf, ownsLook, addLook };
