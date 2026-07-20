// ============================================================
// routes/settings.js — the shared "Save for everyone" numbers.
// ============================================================
// A flat set of CONFIG overrides that everybody's game uses. Anyone
// can read them; changing them is an ADMIN job, because it changes
// the game for every single player. Mounted at /api/settings.

"use strict";

const express = require("express");
const { SETTINGS_FILE, readJson, writeJsonWithBackup } = require("../lib/storage");
const { validateSettings } = require("../lib/validate");
const { guard, can } = require("../lib/auth");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(readJson(SETTINGS_FILE));
});

router.put("/", guard, (req, res) => {
  if (!can(req.account, "settings.edit")) {
    return res.status(403).json({
      error: "Only a grown-up can change the game for everyone. 🙂",
    });
  }
  let clean;
  try { clean = validateSettings(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  writeJsonWithBackup(SETTINGS_FILE, clean);
  res.json(clean);
});

module.exports = router;
