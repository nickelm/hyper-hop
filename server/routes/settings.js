// ============================================================
// routes/settings.js — the shared "Save for everyone" numbers.
// ============================================================
// A flat set of CONFIG overrides that everybody's game uses. Anyone
// can read them; changing them needs the family PIN. Mounted at
// /api/settings.

"use strict";

const express = require("express");
const { SETTINGS_FILE, readJson, writeJsonWithBackup } = require("../lib/storage");
const { validateSettings } = require("../lib/validate");
const { guard } = require("../lib/auth");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(readJson(SETTINGS_FILE));
});

router.put("/", guard, (req, res) => {
  let clean;
  try { clean = validateSettings(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  writeJsonWithBackup(SETTINGS_FILE, clean);
  res.json(clean);
});

module.exports = router;
