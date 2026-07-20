// ============================================================
// routes/profiles.js — the players and their cube skins.
// ============================================================
// Same shape as levels: anyone can read, but making or changing a
// player needs the family PIN. Skins are looks only, never physics.
// Mounted at /api/profiles.

"use strict";

const express = require("express");
const { PROFILES_FILE, readJson, writeJsonWithBackup, nextId, indexById } = require("../lib/storage");
const { validateProfile } = require("../lib/validate");
const { guard } = require("../lib/auth");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(readJson(PROFILES_FILE));
});

router.post("/", guard, (req, res) => {
  let clean;
  try { clean = validateProfile(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const profiles = readJson(PROFILES_FILE);
  const profile = { id: nextId(profiles), ...clean, updatedAt: new Date().toISOString() };
  profiles.push(profile);
  writeJsonWithBackup(PROFILES_FILE, profiles);
  res.status(201).json(profile);
});

router.put("/:id", guard, (req, res) => {
  let clean;
  try { clean = validateProfile(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = Number(req.params.id);
  const profiles = readJson(PROFILES_FILE);
  const i = indexById(profiles, id);
  if (i === -1) return res.status(404).json({ error: "That player does not exist." });

  profiles[i] = { id, ...clean, updatedAt: new Date().toISOString() };
  writeJsonWithBackup(PROFILES_FILE, profiles);
  res.json(profiles[i]);
});

router.delete("/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  const profiles = readJson(PROFILES_FILE);
  const i = indexById(profiles, id);
  if (i === -1) return res.status(404).json({ error: "That player does not exist." });

  const [removed] = profiles.splice(i, 1);
  writeJsonWithBackup(PROFILES_FILE, profiles);
  res.json(removed);
});

module.exports = router;
