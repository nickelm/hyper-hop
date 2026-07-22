// ============================================================
// routes/adventures.js — journeys made of levels.
// ============================================================
// A curator (an editor or an admin) picks some published levels, puts
// them in an order, and gives the list a name. Now everybody can play
// them in that order — beat one and the next unlocks.
//
// The sums that decide how far somebody has got live in
// lib/adventures.js; this file is just the doors. Mounted at
// /api/adventures.

"use strict";

const express = require("express");
const {
  ADVENTURES_FILE, LEVELS_FILE, ACCOUNTS_FILE,
  readJson, updateJson, nextAdventureId, indexById,
} = require("../lib/storage");
const { validateAdventure } = require("../lib/validate");
const { guard, loadAccount, can, publicAccount } = require("../lib/auth");
const { completedIn, scoreOf, adventureForTablet } = require("../lib/adventures");
const { NotFound, NotAllowed } = require("../lib/errors");

const router = express.Router();

/* ---------------- Every adventure ----------------
   Open to everybody. If you're logged in, each one also carries YOUR
   progress, so the tablet can draw the ticks and the padlocks without
   asking again. */
router.get("/", loadAccount, (req, res) => {
  const levels = readJson(LEVELS_FILE);
  res.json(readJson(ADVENTURES_FILE)
    .map(a => adventureForTablet(a, levels, req.account)));
});

/* ---------------- One adventure's score board ----------------
   Everybody, best first, with ties SHARING a rank — if two people have
   both beaten four levels they are both 2nd, and the next person is
   4th. Nobody is pushed down for being equal. */
router.get("/:id/board", (req, res) => {
  const id = Number(req.params.id);
  const adventure = readJson(ADVENTURES_FILE).find(a => Number(a.id) === id);
  if (!adventure) return res.status(404).json({ error: "That adventure does not exist." });

  const total = (adventure.levelIds || []).length;
  const rows = readJson(ACCOUNTS_FILE)
    .map(account => ({
      ...publicAccount(account),
      score: scoreOf(adventure, completedIn(account, id)),
      total,
    }))
    .filter(row => row.score > 0)            // nobody who hasn't started yet
    .sort((a, b) => b.score - a.score);

  // Hand out the ranks. The same score always gets the same number.
  let rank = 0, lastScore = null;
  rows.forEach((row, i) => {
    if (row.score !== lastScore) { rank = i + 1; lastScore = row.score; }
    row.rank = rank;
  });

  res.json({ id, name: adventure.name, total, board: rows });
});

// Making, renaming and rearranging are a curator's job.
function requireCurator(account) {
  if (!can(account, "adventure.manage")) {
    throw new NotAllowed("Only a curator can look after the adventures. 🙂");
  }
}

/* ----------------------------------------------------------------
   ONLY PUBLISHED LEVELS MAY GO IN. An adventure is something everybody
   plays, so it can't be built out of somebody's private drafts. (A
   level that is hidden LATER is simply skipped — see lib/adventures.js
   — so this only has to be true when the list is set.)
   ---------------------------------------------------------------- */
function checkLevelsAreListed(levelIds) {
  if (!levelIds) return;
  const levels = readJson(LEVELS_FILE);
  for (const id of levelIds) {
    const level = levels.find(L => Number(L.id) === Number(id));
    if (!level) throw new NotFound("One of those levels does not exist.");
    if ((level.status || "listed") !== "listed") {
      throw new NotAllowed("\"" + level.name + "\" isn't published yet, so it can't go in an adventure.");
    }
  }
}

// Make a new adventure.
router.post("/", guard, (req, res) => {
  try {
    requireCurator(req.account);
    const patch = validateAdventure(req.body);
    if (!patch.name) throw new Error("Please give the adventure a name.");
    checkLevelsAreListed(patch.levelIds);

    const now = new Date().toISOString();
    // A number that is never used twice, even after an adventure is
    // deleted — everybody's progress is remembered against it, so a
    // reused number would hand a brand-new adventure the old one's
    // ticks and unlock it for people who never played it.
    const id = nextAdventureId();
    const created = updateJson(ADVENTURES_FILE, adventures => {
      const adventure = {
        id,
        name: patch.name,
        levelIds: patch.levelIds || [],
        createdBy: req.account.id,
        createdAt: now,
        updatedAt: now,
      };
      adventures.push(adventure);
      return adventure;
    });
    res.status(201).json(created);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// Rename it, or set its levels. Reordering is just sending the same
// ids in a different order — there is nothing else to it.
router.put("/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  try {
    requireCurator(req.account);
    const patch = validateAdventure(req.body);
    checkLevelsAreListed(patch.levelIds);

    const saved = updateJson(ADVENTURES_FILE, adventures => {
      const at = indexById(adventures, id);
      if (at === -1) throw new NotFound("That adventure does not exist.");
      adventures[at] = { ...adventures[at], ...patch, updatedAt: new Date().toISOString() };
      return adventures[at];
    });
    res.json(saved);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/* ---------------- Delete one ----------------
   The levels themselves are untouched — an adventure is only a list of
   which ones and in what order. Everybody's record of the levels they
   beat stays put too, so putting the adventure back would bring all
   the scores back with it. */
router.delete("/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  try {
    requireCurator(req.account);
    const removed = updateJson(ADVENTURES_FILE, adventures => {
      const at = indexById(adventures, id);
      if (at === -1) throw new NotFound("That adventure does not exist.");
      return adventures.splice(at, 1)[0];
    });
    res.json(removed);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
