// ============================================================
// routes/levels.js — the levels list (make, edit, reorder, delete).
// ============================================================
// Anyone can READ the levels. Making one means being logged in;
// changing or deleting one means it's yours (or that you're an editor
// or an admin). lib/auth.js decides all of that — this file just
// asks it.
//
// Making a brand-new level also earns you a thank-you in coins.
// Mounted at /api/levels.

"use strict";

const express = require("express");
const {
  LEVELS_FILE, ACCOUNTS_FILE, readJson, writeJsonWithBackup, updateJson,
  SKIP_SAVE, nextLevelId, indexById,
} = require("../lib/storage");
const { validateLevel } = require("../lib/validate");
const { guard, can } = require("../lib/auth");
const { getPrices } = require("../lib/prices");
const { NotFound, NotAllowed } = require("../lib/errors");

const router = express.Router();

/* ----------------------------------------------------------------
   THE NEW-LEVEL BOUNTY. Making a level for everyone to play deserves
   a reward — but only for levels that really are NEW.

   The trick is to count. We remember how many bounties you've been
   paid, and we only pay again when you own MORE levels than that. So
   your 1st, 2nd and 3rd levels each pay once... but making a level,
   deleting it and making it again leaves you with the same number of
   levels, so it pays nothing. No coin machine. 😄
   ---------------------------------------------------------------- */
function payLevelBounty(accountId, levelsOwned) {
  const prices = getPrices();
  return updateJson(ACCOUNTS_FILE, accounts => {
    const me = accounts.find(a => Number(a.id) === Number(accountId));
    if (!me) return SKIP_SAVE;
    const alreadyPaid = Number(me.bountiesPaid) || 0;
    if (levelsOwned <= alreadyPaid) return SKIP_SAVE;    // not a new one, really
    me.bountiesPaid = alreadyPaid + 1;
    me.coins += prices.levelCreateBounty;
    me.coinsEarnedTotal += prices.levelCreateBounty;
    me.updatedAt = new Date().toISOString();
    return { credited: prices.levelCreateBounty, balance: me.coins, coinsEarnedTotal: me.coinsEarnedTotal };
  });
}

// Everyone can read all the levels.
router.get("/", (req, res) => {
  res.json(readJson(LEVELS_FILE));
});

// How many coins one level may hold. It lives in the price list with the rest
// of the money numbers, so a grown-up can change it by hand without a restart.
function coinLimit() {
  return { maxCoins: getPrices().maxCoinsPerLevel };
}

// Make a brand-new level (the server picks its number).
router.post("/", guard, (req, res) => {
  let clean;
  try { clean = validateLevel(req.body, coinLimit()); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  if (!can(req.account, "level.create")) {
    return res.status(403).json({ error: "You can't make levels right now." });
  }

  const level = {
    id: nextLevelId(),
    ...clean,
    ownerId: req.account.id,          // it's yours — you can always change it
    updatedAt: new Date().toISOString(),
  };
  const levelsOwned = updateJson(LEVELS_FILE, levels => {
    levels.push(level);
    return levels.filter(L => Number(L.ownerId) === Number(req.account.id)).length;
  });

  const bounty = payLevelBounty(req.account.id, levelsOwned);
  res.status(201).json({
    ...level,
    bounty: bounty === SKIP_SAVE ? null : bounty,
  });
});

// Change the order of the levels. The tablet sends the full list of level ids
// in the new order; we rewrite levels.json to match. (This route must come
// before "/:id" below, or ":id" would grab the word "order".)
router.put("/order", guard, (req, res) => {
  if (!can(req.account, "level.reorder")) {
    return res.status(403).json({ error: "Only a grown-up can change the level order. 🙂" });
  }
  const order = req.body && req.body.order;
  try {
    const reordered = updateJson(LEVELS_FILE, levels => {
      // The new order must list exactly the ids we already have, each one once.
      if (!Array.isArray(order) || order.length !== levels.length) {
        throw new Error("That new order doesn't match the levels.");
      }
      const byId = new Map(levels.map(L => [Number(L.id), L]));
      const sorted = [];
      for (const id of order) {
        const L = byId.get(Number(id));
        if (!L || sorted.includes(L)) throw new Error("That new order doesn't match the levels.");
        sorted.push(L);
      }
      levels.length = 0;
      levels.push(...sorted);
      return sorted;
    });
    res.json(reordered);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Save changes to one level.
router.put("/:id", guard, (req, res) => {
  let clean;
  try { clean = validateLevel(req.body, coinLimit()); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = Number(req.params.id);
  try {
    const saved = updateJson(LEVELS_FILE, levels => {
      const at = indexById(levels, id);
      if (at === -1) throw new NotFound("That level does not exist.");
      if (!can(req.account, "level.edit", levels[at])) {
        throw new NotAllowed("That's someone else's level — ask them to change it! 🙂");
      }
      // MERGE, so the level keeps who it belongs to. (Building a fresh
      // object here would quietly make every level ownerless.)
      levels[at] = { ...levels[at], ...clean, updatedAt: new Date().toISOString() };
      return levels[at];
    });
    res.json(saved);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Delete one level.
router.delete("/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  try {
    const removed = updateJson(LEVELS_FILE, levels => {
      const at = indexById(levels, id);
      if (at === -1) throw new NotFound("That level does not exist.");
      if (!can(req.account, "level.delete", levels[at])) {
        throw new NotAllowed("That's someone else's level — you can only delete your own. 🙂");
      }
      return levels.splice(at, 1)[0];
    });
    res.json(removed);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
