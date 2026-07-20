// ============================================================
// routes/leaderboard.js — the trophy board.
// ============================================================
// Who has earned the most coins EVER? Note "earned", not "has left".
// That's the whole idea: if the board used your purse, then buying a
// nice cube would knock you down the rankings and nobody would ever
// buy anything. Spending must never cost you your place.

"use strict";

const express = require("express");
const { ACCOUNTS_FILE, readJson } = require("../lib/storage");
const { publicAccount } = require("../lib/auth");

const router = express.Router();

router.get("/", (req, res) => {
  const board = readJson(ACCOUNTS_FILE)
    .map(publicAccount)
    .sort((a, b) => (b.coinsEarnedTotal || 0) - (a.coinsEarnedTotal || 0));
  res.json(board);
});

module.exports = router;
