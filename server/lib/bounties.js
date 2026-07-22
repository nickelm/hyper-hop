// ============================================================
// bounties.js — the prize you put on your own level.
// ============================================================
// A BOUNTY is a challenge: "the first three people to beat my level
// each get 20 coins". You pay for all three prizes THE MOMENT you set
// it up, and those coins sit on the level itself (that's the `bounty`
// on the level's record) until somebody wins them.
//
// Paying up front is the whole point. It means the prize is really
// there — nobody can promise 100 coins they haven't got, and nobody
// can take the prize away again just because somebody nearly won it.
// The only way the coins come back is if the level is hidden or
// deleted, and then they go straight back to whoever put them up.
//
// Three rules are baked in here, so no route has to remember them:
//   * you can never win your own bounty (you already paid for it!);
//   * the same person can never win one twice;
//   * when the slots run out, the bounty is over.

"use strict";

const { LEVELS_FILE, updateJson, SKIP_SAVE, indexById } = require("./storage");

// What a bounty on a level looks like once it's set up.
function makeBounty(amountPer, slots) {
  return { amountPer, slotsLeft: slots, claimedBy: [] };
}

// Is there a prize still waiting to be won on this level?
function isLive(bounty) {
  return !!bounty && Number(bounty.slotsLeft) > 0;
}

/* ----------------------------------------------------------------
   CLAIM A SLOT. Called the instant somebody finishes a level, and it
   answers with how many coins they just won — 0 if there was nothing
   for them.

   IMPORTANT (see routes/runs.js): whoever calls this must credit those
   coins in the very same breath, with no `await` in between. Both this
   and the crediting read-and-write a file in one uninterrupted go, so
   two tablets racing for the last slot are dealt with one after the
   other and exactly one of them gets paid. An `await` in the middle
   would open that gap right back up and they could both win it.
   ---------------------------------------------------------------- */
function claimBountySlot(levelId, accountId) {
  const won = updateJson(LEVELS_FILE, levels => {
    const at = indexById(levels, levelId);
    if (at === -1) return SKIP_SAVE;
    const level = levels[at];
    const bounty = level.bounty;
    if (!isLive(bounty)) return SKIP_SAVE;                    // no prize left
    // You paid for this prize yourself, so it isn't for you — and it
    // doesn't use up a slot either. Somebody else can still win it.
    if (Number(level.ownerId) === Number(accountId)) return SKIP_SAVE;
    // One prize each. Beating it again is still fun, just not paid.
    if (bounty.claimedBy.some(id => Number(id) === Number(accountId))) return SKIP_SAVE;

    bounty.slotsLeft = Number(bounty.slotsLeft) - 1;
    bounty.claimedBy = [...bounty.claimedBy, accountId];
    level.updatedAt = new Date().toISOString();
    return bounty.amountPer;
  });
  return won === SKIP_SAVE ? 0 : won;
}

/* ----------------------------------------------------------------
   PUT A SLOT BACK. If claiming worked but PAYING somehow didn't, the
   prize would be gone and nobody would have it. So whoever claims puts
   it back if the paying falls over (see routes/runs.js).
   ---------------------------------------------------------------- */
function returnBountySlot(levelId, accountId) {
  updateJson(LEVELS_FILE, levels => {
    const at = indexById(levels, levelId);
    if (at === -1 || !levels[at].bounty) return SKIP_SAVE;
    const bounty = levels[at].bounty;
    const wasClaimed = bounty.claimedBy.some(id => Number(id) === Number(accountId));
    if (!wasClaimed) return SKIP_SAVE;                 // never had it — nothing to undo
    bounty.claimedBy = bounty.claimedBy.filter(id => Number(id) !== Number(accountId));
    bounty.slotsLeft = Number(bounty.slotsLeft) + 1;
    return true;
  });
}

/* ----------------------------------------------------------------
   TAKE THE UNWON COINS BACK. Used when a level is hidden or deleted:
   whatever nobody won goes home to the person who put it up. Changes
   the level in place (so it rides along with the save that's already
   happening) and answers who to pay and how much.
   ---------------------------------------------------------------- */
function takeBackEscrow(level) {
  const bounty = level && level.bounty;
  if (!isLive(bounty)) {
    if (level) level.bounty = null;
    return { ownerId: null, coins: 0 };
  }
  const coins = Number(bounty.amountPer) * Number(bounty.slotsLeft);
  level.bounty = null;
  return { ownerId: level.ownerId, coins };
}

module.exports = { makeBounty, isLive, claimBountySlot, returnBountySlot, takeBackEscrow };
