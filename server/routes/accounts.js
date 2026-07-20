// ============================================================
// routes/accounts.js — changing a player, and the cube shop.
// ============================================================
// Saving your cube is also SHOPPING: each part you change costs
// coins. The server works out what really changed and what that
// costs, so the price is always the true one — a tablet can't just
// say "this was free".
//
// Being kind is the point here. Keeping a part the same is always
// free, so the classic green cube costs nothing, forever.

"use strict";

const express = require("express");
const { ACCOUNTS_FILE, updateJson, indexById } = require("../lib/storage");
const { validateAccountEdit } = require("../lib/validate");
const { guard, can, meView } = require("../lib/auth");
const { getPrices } = require("../lib/prices");
const { NotFound, NotAllowed } = require("../lib/errors");

const router = express.Router();

/* ----------------------------------------------------------------
   WHAT DID YOU CHANGE, AND WHAT DOES IT COST?
   We compare the cube you sent with the cube we have saved, part by
   part. Only the parts that are actually DIFFERENT cost anything.
   ---------------------------------------------------------------- */
function priceTheChanges(oldSkin, newSkin, skinPrices) {
  const bought = [];
  let total = 0;
  if (!newSkin) return { bought, total };
  for (const part of Object.keys(skinPrices)) {
    if (newSkin[part] !== (oldSkin || {})[part]) {
      bought.push({ part, price: skinPrices[part] });
      total += skinPrices[part];
    }
  }
  return { bought, total };
}

// Change a player: their name, their cube, or both.
router.put("/:id", guard, (req, res) => {
  let patch;
  try { patch = validateAccountEdit(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = Number(req.params.id);
  const prices = getPrices();

  try {
    const result = updateJson(ACCOUNTS_FILE, accounts => {
      const at = indexById(accounts, id);
      if (at === -1) throw new NotFound("That player does not exist.");
      const account = accounts[at];
      if (!can(req.account, "account.edit", account)) {
        throw new NotAllowed("That's somebody else's cube! 🙂");
      }

      // Two players with the same name would muddle up the scores.
      if (patch.name && accounts.some((a, i) =>
        i !== at && String(a.name).toLowerCase() === patch.name.toLowerCase())) {
        throw new NotAllowed("Somebody already has that name — try another one!");
      }

      const { bought, total } = priceTheChanges(account.skin, patch.skin, prices.skin);
      if (total > account.coins) {
        const short = total - account.coins;
        throw new NotAllowed(
          "That cube costs " + total + " coins and you have " + account.coins +
          ". Go and grab " + short + " more — you're nearly there! 💪");
      }

      // MERGE onto the saved player — never rebuild them from scratch.
      // Everything we don't mention here (password, coins earned, which
      // coins you've collected, your job) has to survive untouched.
      accounts[at] = {
        ...account,
        ...patch,
        coins: account.coins - total,
        updatedAt: new Date().toISOString(),
      };

      // A tripwire. If somebody ever "tidies" the line above back into
      // building a fresh object, this shouts instead of quietly
      // deleting everybody's password.
      if (accounts[at].passwordHash === undefined || accounts[at].coinsEarnedTotal === undefined) {
        throw new Error("Saving a player would have lost some of their things — not saving.");
      }

      return { account: meView(accounts[at]), spent: total, bought };
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
