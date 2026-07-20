// ============================================================
// routes/scores.js — everyone's best % on each level.
// ============================================================
// Saving a score is the ONE change that does NOT need the family
// PIN: kids beat their best all the time, and asking for the PIN
// every run would be no fun. It's still frozen by READ_ONLY.
// Mounted at /api/scores.

"use strict";

const express = require("express");
const { LEVELS_FILE, SCORES_FILE, readJson, writeJsonWithBackup } = require("../lib/storage");
const { validateScore } = require("../lib/validate");
const { notFrozen } = require("../lib/auth");

const router = express.Router();

// Anyone can read the scores.
router.get("/", (req, res) => {
  res.json(readJson(SCORES_FILE));
});

// Save a score — no family PIN needed (but still frozen by READ_ONLY).
router.post("/", notFrozen, (req, res) => {
  const levels = readJson(LEVELS_FILE);
  let clean;
  try { clean = validateScore(req.body, levels); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const scores = readJson(SCORES_FILE);
  // One row per (level, player). Only write when this beats their old best.
  const row = scores.find(s => Number(s.levelId) === clean.levelId && s.player === clean.player);
  if (!row) {
    scores.push({ ...clean, updatedAt: new Date().toISOString() });
    writeJsonWithBackup(SCORES_FILE, scores);
  } else if (clean.percent > row.percent) {
    row.percent = clean.percent;
    row.updatedAt = new Date().toISOString();
    writeJsonWithBackup(SCORES_FILE, scores);
  }

  // Send back just this level's leaderboard, best first, so the tablet can
  // update what it shows without re-fetching everything.
  const board = scores
    .filter(s => Number(s.levelId) === clean.levelId)
    .sort((a, b) => b.percent - a.percent);
  res.json(board);
});

module.exports = router;
