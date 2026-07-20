// ============================================================
// routes/scores.js — everyone's best % on each level.
// ============================================================
// You have to be logged in (we save the score under YOUR name, so we
// need to know who you are), but there's no extra permission to
// check: playing and beating your best is what the game is for.
// Still frozen by READ_ONLY. Mounted at /api/scores.

"use strict";

const express = require("express");
const {
  LEVELS_FILE, SCORES_FILE, readJson, updateJson, SKIP_SAVE,
} = require("../lib/storage");
const { validateScore } = require("../lib/validate");
const { guard } = require("../lib/auth");

const router = express.Router();

// Anyone can read the scores.
router.get("/", (req, res) => {
  res.json(readJson(SCORES_FILE));
});

// Save a score.
router.post("/", guard, (req, res) => {
  const levels = readJson(LEVELS_FILE);
  // The score always belongs to whoever is logged in — a tablet
  // doesn't get to say "this one's for somebody else".
  let clean;
  try { clean = validateScore({ ...req.body, player: req.account.name }, levels); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const accountId = req.account.id;

  updateJson(SCORES_FILE, scores => {
    // One row per (level, player). We look you up by your id, and fall
    // back to your name for old rows saved before players had ids.
    const row = scores.find(s => Number(s.levelId) === clean.levelId &&
      (s.accountId != null ? Number(s.accountId) === Number(accountId) : s.player === clean.player));

    if (!row) {
      scores.push({ ...clean, accountId, updatedAt: new Date().toISOString() });
    } else if (clean.percent > row.percent) {
      row.percent = clean.percent;
      row.accountId = accountId;         // tidy up an old name-only row
      row.player = clean.player;
      row.updatedAt = new Date().toISOString();
    } else {
      return SKIP_SAVE;                  // not an improvement — nothing to save
    }
  });

  // Send back just this level's leaderboard, best first, so the tablet can
  // update what it shows without re-fetching everything.
  res.json(readJson(SCORES_FILE)
    .filter(s => Number(s.levelId) === clean.levelId)
    .sort((a, b) => b.percent - a.percent));
});

module.exports = router;
