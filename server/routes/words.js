// ============================================================
// routes/words.js — the words the 🎲 dice picks from.
// ============================================================
// The editor's dice button makes up a level name out of one word from
// each list ("Turbo Canyon"). The lists live in lib/words.js so there
// is only ever ONE copy of them — the tablet asks for them here, once,
// when the game starts.
//
// Reading is open to everybody, like every other read. Mounted at
// /api/words.

"use strict";

const express = require("express");
const { ADJECTIVES, NOUNS } = require("../lib/words");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({ adjectives: ADJECTIVES, nouns: NOUNS });
});

module.exports = router;
