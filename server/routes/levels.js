// ============================================================
// routes/levels.js — the levels list, and a level's whole life.
// ============================================================
// A level goes through three places:
//
//     draft  ──publish (costs coins)──▶  listed  ◀──unhide──┐
//                                          │                │
//                                          └────hide────▶ hidden
//
//   draft   just yours. Free to make, free to change, and NOBODY else
//           can see it — not even in a list. This is where you fiddle
//           about until it's good.
//   listed  published: everybody can see it and play it. Publishing
//           costs the publish fee, which is why we don't hand levels
//           out by accident.
//   hidden  a curator took it off the list because something was
//           wrong. It is NOT deleted — the owner still sees it, and a
//           curator can put it straight back.
//
// Making a level used to PAY you a bounty. It doesn't any more:
// publishing costs instead, and the coins come back when other people
// beat what you made (see bounties, below).
//
// lib/auth.js decides who may do each of these — this file just asks.
// Mounted at /api/levels.

"use strict";

const express = require("express");
const {
  LEVELS_FILE, ACCOUNTS_FILE, STARS_FILE, readJson, updateJson,
  SKIP_SAVE, nextLevelId, indexById,
} = require("../lib/storage");
const { validateLevel, validateBounty } = require("../lib/validate");
const { guard, loadAccount, can, visibleTo } = require("../lib/auth");
const { getPrices } = require("../lib/prices");
const { makeBounty, isLive, takeBackEscrow } = require("../lib/bounties");
const { NotFound, NotAllowed } = require("../lib/errors");

const router = express.Router();

/* ----------------------------------------------------------------
   THE STARS a level has. We count them fresh every time rather than
   keeping a number on the level, so a star can never drift out of step
   with who really tapped it (and a deleted account's star simply stops
   counting).
   ---------------------------------------------------------------- */
function starsByLevel() {
  const counts = new Map();
  for (const row of readJson(STARS_FILE)) {
    const id = Number(row.levelId);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

// The level as a tablet should see it: whatever is saved, plus how many
// stars it has and whether YOU gave it one.
function levelForTablet(level, counts, myStars) {
  return {
    ...level,
    status: level.status || "listed",       // levels from before the lifecycle
    bounty: level.bounty || null,
    starCount: counts.get(Number(level.id)) || 0,
    starredByMe: myStars.has(Number(level.id)),
  };
}

/* ---------------- The list ----------------
   Open to everybody, but you only see what you're allowed to see:
   listed levels, your own (whatever state they're in), and — if you're
   a curator — the hidden ones too. A draft never leaves the server. */
router.get("/", loadAccount, (req, res) => {
  const counts = starsByLevel();
  const me = req.account;
  const myStars = new Set(
    me ? readJson(STARS_FILE)
      .filter(s => Number(s.accountId) === Number(me.id))
      .map(s => Number(s.levelId)) : []);

  res.json(readJson(LEVELS_FILE)
    .filter(L => visibleTo(L, me))
    .map(L => levelForTablet(L, counts, myStars)));
});

// How many coins one level may hold, and every level there is (so a name
// can't be used twice). Both are handed IN to validateLevel rather than
// looked up in there — see the note on validateLevel. `canSee` lets the
// "that name's taken" message name the other level only when you'd be
// allowed to see it anyway.
function saveLimits(account, exceptId) {
  return {
    maxCoins: getPrices().maxCoinsPerLevel,
    levels: readJson(LEVELS_FILE),
    exceptId,
    canSee: L => visibleTo(L, account),
  };
}

/* ---------------- Make a brand-new level ----------------
   It starts as a DRAFT: free, and only you can see it. Show it to
   everybody later with Publish. */
router.post("/", guard, (req, res) => {
  let clean;
  try { clean = validateLevel(req.body, saveLimits(req.account, null)); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  if (!can(req.account, "level.create")) {
    return res.status(403).json({ error: "You can't make levels right now." });
  }

  const now = new Date().toISOString();
  const level = {
    id: nextLevelId(),
    ...clean,
    ownerId: req.account.id,          // it's yours — you can always change it
    status: "draft",                  // just for you, until you publish it
    bounty: null,
    createdAt: now,
    updatedAt: now,
  };
  updateJson(LEVELS_FILE, levels => { levels.push(level); });

  res.status(201).json({ ...level, starCount: 0, starredByMe: false });
});

/* ---------------- Change the order of the levels ----------------
   The tablet sends the ids it can SEE, in the order it wants them. We
   shuffle just those levels between the places they already sit in, and
   every other level stays exactly where it is.

   That "just those" matters. The tablet's list is never the whole list —
   drafts are missing from it, hidden levels are missing from it, and a
   player who was given the reorder power sees fewer levels still. If we
   insisted on being sent every level (which is what this used to do),
   the ▲▼ buttons would either move the wrong level or refuse outright.
   Sending a partial list can't lose a level: we only ever permute the
   ones named, in the slots they already occupy.

   (This route must come before "/:id" below, or ":id" would grab the
   word "order".) */
router.put("/order", guard, (req, res) => {
  if (!can(req.account, "level.reorder")) {
    return res.status(403).json({ error: "Only a grown-up can change the level order. 🙂" });
  }
  const order = req.body && req.body.order;
  try {
    const reordered = updateJson(LEVELS_FILE, levels => {
      if (!Array.isArray(order) || !order.length) {
        throw new Error("That new order doesn't match the levels.");
      }
      // Every id must be a real level, and no level twice.
      const wanted = [];
      for (const id of order) {
        const at = indexById(levels, id);
        if (at === -1 || wanted.includes(at)) {
          throw new Error("That new order doesn't match the levels.");
        }
        wanted.push(at);
      }
      // The places those levels sit in now, lowest first — then drop the
      // levels back into them in the order we were asked for.
      const slots = [...wanted].sort((a, b) => a - b);
      const moving = wanted.map(at => levels[at]);
      slots.forEach((slot, i) => { levels[slot] = moving[i]; });
      return levels.filter(L => visibleTo(L, req.account));
    });
    res.json(reordered);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/* ================================================================
   ==============  PUBLISHING: SHOW IT TO EVERYBODY  ==============
   ================================================================
   The one thing in the game you SPEND coins on that isn't a cube.
   Making levels is free and you can make as many as you like; putting
   one in front of everybody is what costs — which is what keeps the
   list worth reading.

   Both writes happen with no `await` in between, so a tablet tapping
   Publish twice quickly can never be charged twice: the second one
   finds the level already listed and is turned away. */
router.post("/:id/publish", guard, (req, res) => {
  const id = Number(req.params.id);
  // The fee is for the kids. An editor or an admin is looking after the
  // game rather than showing off their own level, so it costs them
  // nothing — and with nothing to pay we never touch accounts.json at
  // all, which keeps the backups folder quiet too.
  const free = can(req.account, "level.publishFree");
  const fee = free ? 0 : getPrices().publishFee;

  try {
    // 1. Check it really is your draft, and that you can afford it.
    const levels = readJson(LEVELS_FILE);
    const level = levels.find(L => Number(L.id) === id);
    if (!level) throw new NotFound("That level does not exist.");
    if (!can(req.account, "level.publish", level)) {
      throw new NotAllowed("That's someone else's level — only they can publish it. 🙂");
    }
    if ((level.status || "listed") !== "draft") {
      throw new NotAllowed("That level is already out there for everybody. 🎉");
    }

    // 2. Take the coins. If the purse is too light we stop right here
    //    and the level stays a draft, safe and sound. (Free? Then there
    //    is nothing to take, and nothing to save.)
    const paid = fee === 0
      ? { balance: req.account.coins, coinsEarnedTotal: req.account.coinsEarnedTotal }
      : updateJson(ACCOUNTS_FILE, accounts => {
        const me = accounts.find(a => Number(a.id) === Number(req.account.id));
        if (!me) throw new NotFound("Who are you? Try logging in again.");
        if (me.coins < fee) {
          const short = fee - me.coins;
          throw new NotAllowed(
            "Publishing costs " + fee + " coins and you have " + me.coins +
            ". Go and grab " + short + " more — your level is saved and waiting! 💪");
        }
        me.coins -= fee;
        me.updatedAt = new Date().toISOString();
        return { balance: me.coins, coinsEarnedTotal: me.coinsEarnedTotal };
      });

    // 3. Out it goes. (No `await` above, so nothing can have changed
    //    the level in between.)
    const published = updateJson(LEVELS_FILE, all => {
      const at = indexById(all, id);
      if (at === -1) throw new NotFound("That level does not exist.");
      all[at].status = "listed";
      all[at].publishedAt = new Date().toISOString();
      all[at].updatedAt = all[at].publishedAt;
      return all[at];
    });

    res.json({ level: published, spent: fee, balance: paid.balance,
               coinsEarnedTotal: paid.coinsEarnedTotal });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/* ================================================================
   ================  HIDING: THE MODERATION VALVE  ================
   ================================================================
   A curator can take a level off the list — because it's broken,
   impossible, or just not very kind. It is NOT deleted: its owner
   still sees it (and is told a curator hid it), and unhiding puts it
   straight back. Any bounty coins nobody won come home at the same
   time, because a hidden level can't be beaten. */
function setHidden(req, res, hidden) {
  const id = Number(req.params.id);
  try {
    const changed = updateJson(LEVELS_FILE, levels => {
      const at = indexById(levels, id);
      if (at === -1) throw new NotFound("That level does not exist.");
      if (!can(req.account, "level.hide")) {
        throw new NotAllowed("Only a curator can do that. 🙂");
      }
      const level = levels[at];
      // Hiding is about taking a level OFF THE LIST, so it only makes
      // sense for a level that is on it. Without this, a curator could
      // hide their own draft and then "unhide" it straight onto the
      // list — publishing it for free. 🙃
      const status = level.status || "listed";
      if (hidden && status !== "listed") {
        throw new NotAllowed("That level isn't on the list, so there's nothing to take off it.");
      }
      if (!hidden && status !== "hidden") {
        throw new NotAllowed("That level isn't hidden.");
      }
      const now = new Date().toISOString();
      let refund = { ownerId: null, coins: 0 };
      if (hidden) {
        refund = takeBackEscrow(level);      // nobody can win it now
        level.status = "hidden";
        level.hiddenAt = now;
      } else {
        level.status = "listed";
        delete level.hiddenAt;
      }
      level.updatedAt = now;
      return { level, refund };
    });

    // Give the unwon prize money back. Straight after the write above,
    // with nothing in between, so it can't go missing.
    if (changed.refund.coins > 0) creditCoins(changed.refund.ownerId, changed.refund.coins);
    res.json(changed.level);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
}
router.post("/:id/hide", guard, (req, res) => setHidden(req, res, true));
router.post("/:id/unhide", guard, (req, res) => setHidden(req, res, false));

// Put coins into somebody's purse. Used for bounty refunds: these are
// coins they already had, so they do NOT count as newly earned and
// can't push anybody up the trophy board.
function creditCoins(accountId, coins) {
  if (accountId == null || !(coins > 0)) return;
  updateJson(ACCOUNTS_FILE, accounts => {
    const owner = accounts.find(a => Number(a.id) === Number(accountId));
    if (!owner) return SKIP_SAVE;
    owner.coins += coins;
    owner.updatedAt = new Date().toISOString();
  });
}

/* ================================================================
   ===============  BOUNTIES: A PRIZE ON YOUR LEVEL  ==============
   ================================================================
   "First three people to beat this get 20 coins each." You pay for all
   three up front, so the prize is really there — and you can't take it
   back once somebody is having a go. See lib/bounties.js. */
router.post("/:id/bounty", guard, (req, res) => {
  const id = Number(req.params.id);
  const prices = getPrices();

  let wanted;
  try { wanted = validateBounty(req.body, prices); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const total = wanted.amountPer * wanted.slots;

  try {
    const levels = readJson(LEVELS_FILE);
    const level = levels.find(L => Number(L.id) === id);
    if (!level) throw new NotFound("That level does not exist.");
    if (!can(req.account, "level.bounty", level)) {
      throw new NotAllowed("You can only put a prize on your own level. 🙂");
    }
    if ((level.status || "listed") !== "listed") {
      throw new NotAllowed("Publish the level first, then people can win the prize!");
    }
    if (isLive(level.bounty)) {
      throw new NotAllowed("This level already has a prize on it. Wait until it's been won!");
    }

    // Pay for every slot, now.
    const paid = updateJson(ACCOUNTS_FILE, accounts => {
      const me = accounts.find(a => Number(a.id) === Number(req.account.id));
      if (!me) throw new NotFound("Who are you? Try logging in again.");
      if (me.coins < total) {
        const short = total - me.coins;
        throw new NotAllowed(
          wanted.slots + " prizes of " + wanted.amountPer + " costs " + total +
          " coins and you have " + me.coins + ". You need " + short + " more. 💪");
      }
      me.coins -= total;
      me.updatedAt = new Date().toISOString();
      return { balance: me.coins };
    });

    const saved = updateJson(LEVELS_FILE, all => {
      const at = indexById(all, id);
      if (at === -1) throw new NotFound("That level does not exist.");
      all[at].bounty = makeBounty(wanted.amountPer, wanted.slots);
      all[at].updatedAt = new Date().toISOString();
      return all[at];
    });

    res.json({ level: saved, spent: total, balance: paid.balance });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Save changes to one level. This never changes its status or its
// bounty — those have routes of their own — and because we MERGE, they
// come through a save untouched.
router.put("/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  let clean;
  try { clean = validateLevel(req.body, saveLimits(req.account, id)); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  try {
    const saved = updateJson(LEVELS_FILE, levels => {
      const at = indexById(levels, id);
      if (at === -1) throw new NotFound("That level does not exist.");
      if (!can(req.account, "level.edit", levels[at])) {
        throw new NotAllowed("That's someone else's level — ask them to change it! 🙂");
      }
      // MERGE, so the level keeps who it belongs to, where it is in its
      // life, and any prize on it. (Building a fresh object here would
      // quietly make every level ownerless and unpublished.)
      levels[at] = { ...levels[at], ...clean, updatedAt: new Date().toISOString() };
      return levels[at];
    });
    res.json(saved);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Delete one level. Any prize nobody won goes back to its owner.
router.delete("/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  try {
    const gone = updateJson(LEVELS_FILE, levels => {
      const at = indexById(levels, id);
      if (at === -1) throw new NotFound("That level does not exist.");
      if (!can(req.account, "level.delete", levels[at])) {
        throw new NotAllowed("That's someone else's level — you can only delete your own. 🙂");
      }
      const refund = takeBackEscrow(levels[at]);
      return { level: levels.splice(at, 1)[0], refund };
    });
    if (gone.refund.coins > 0) creditCoins(gone.refund.ownerId, gone.refund.coins);
    res.json(gone.level);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
