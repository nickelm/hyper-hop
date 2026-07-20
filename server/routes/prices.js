// ============================================================
// routes/prices.js — "what does everything cost?"
// ============================================================
// The cube editor asks for this so it can show a live price on the
// Save button. There's no way to CHANGE prices over the web on
// purpose — a grown-up edits data/prices.json by hand, and the shop
// picks it up straight away without a restart.

"use strict";

const express = require("express");
const { getPrices } = require("../lib/prices");

const router = express.Router();

router.get("/", (req, res) => res.json(getPrices()));

module.exports = router;
