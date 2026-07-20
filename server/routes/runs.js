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

"use strict";

const express = require("express");
const {
  LEVELS_FILE, ACCOUNTS_FILE, readJson, updateJson, SKIP_SAVE,
} = require("../lib/storage");
const { coinKeysFor } = require("../lib/validate");
const { guard, can } = require("../lib/auth");
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

      if (!fresh.length) {
        return SKIP_SAVE;      // nothing new — don't churn the backups
      }

      const credited = fresh.length * prices.coinValue;
      me.coins += credited;
      me.coinsEarnedTotal += credited;
      me.collectedCoins[levelKey] = [...alreadyPaid, ...fresh];
      me.updatedAt = new Date().toISOString();
      return { credited, balance: me.coins, coinsEarnedTotal: me.coinsEarnedTotal };
    });

    if (result === SKIP_SAVE) {
      return res.json({
        credited: 0,
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
