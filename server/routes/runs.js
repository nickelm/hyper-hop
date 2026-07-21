// ============================================================
// routes/runs.js — "I finished a level!" → coins.
// ============================================================
// The tablet says which coins it picked up; the SERVER decides what
// that's worth. That's on purpose: the purse has to live somewhere a
// tablet can't reach in and change it.
//
// Two rules keep it fair:
//   1. Only coins that really exist in that level count. (No inventing
//      coins that aren't there.)
//   2. Each coin only ever pays ONCE. Playing a level again is still
//      fun, but it doesn't print money — the coins you were already
//      paid for show up silver.
//
// Finishing is also how you WIN A LOOK: a level that carries its own
// cube (see cleanReward in lib/validate.js) hands it over the first
// time you reach the flag, and it's yours to wear forever after.

"use strict";

const express = require("express");
const {
  LEVELS_FILE, ACCOUNTS_FILE, readJson, updateJson, SKIP_SAVE,
} = require("../lib/storage");
const { coinKeysFor } = require("../lib/validate");
const { guard, can } = require("../lib/auth");
const { addLook } = require("../lib/looks");
const { getPrices } = require("../lib/prices");
const { NotFound, NotAllowed } = require("../lib/errors");

const router = express.Router();

router.post("/", guard, (req, res) => {
  const { levelId, collectedCoinKeys, completed } = req.body || {};

  if (!can(req.account, "run.report")) {
    return res.status(403).json({ error: "You can't save runs right now." });
  }

  const level = readJson(LEVELS_FILE).find(L => Number(L.id) === Number(levelId));
  if (!level) return res.status(400).json({ error: "That level does not exist." });

  // Didn't reach the flag? Then no coins yet — go and beat it! We don't
  // save anything at all here, so a half-finished run never makes a
  // backup file.
  if (completed !== true) {
    return res.json({
      credited: 0,
      unlocked: null,
      balance: req.account.coins,
      coinsEarnedTotal: req.account.coinsEarnedTotal,
    });
  }

  const realCoins = coinKeysFor(level.level);
  const levelKey = String(levelId);
  const prices = getPrices();

  try {
    const result = updateJson(ACCOUNTS_FILE, accounts => {
      const me = accounts.find(a => Number(a.id) === Number(req.account.id));
      if (!me) throw new NotFound("Who are you? Try logging in again.");

      me.collectedCoins = me.collectedCoins || {};
      const alreadyPaid = new Set(me.collectedCoins[levelKey] || []);

      // Keep only the coins that really are in this level AND that we
      // haven't already paid you for. Sending the same coin twice in
      // one message doesn't count twice either.
      const sent = Array.isArray(collectedCoinKeys) ? collectedCoinKeys : [];
      const fresh = [...new Set(sent)].filter(
        key => typeof key === "string" && realCoins.has(key) && !alreadyPaid.has(key));

      let credited = 0;
      if (fresh.length) {
        credited = fresh.length * prices.coinValue;
        me.coins += credited;
        me.coinsEarnedTotal += credited;
        me.collectedCoins[levelKey] = [...alreadyPaid, ...fresh];
      }

      // THE PRIZE. Some levels are played as their own character, and
      // finishing one gives you that cube to keep. This has to happen even
      // when there were no new coins — the tenth time you beat a level is
      // still the first time you might unlock its look.
      let unlocked = null;
      if (level.reward && level.reward.skin &&
          addLook(me, level.reward.skin, level.reward.name, "level")) {
        unlocked = { name: level.reward.name, skin: level.reward.skin };
      }

      if (!credited && !unlocked) {
        return SKIP_SAVE;      // nothing new — don't churn the backups
      }

      me.updatedAt = new Date().toISOString();
      return { credited, unlocked, balance: me.coins, coinsEarnedTotal: me.coinsEarnedTotal };
    });

    if (result === SKIP_SAVE) {
      return res.json({
        credited: 0,
        unlocked: null,
        balance: req.account.coins,
        coinsEarnedTotal: req.account.coinsEarnedTotal,
      });
    }
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
