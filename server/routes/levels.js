// ============================================================
// routes/levels.js — the levels list (make, edit, reorder, delete).
// ============================================================
// Anyone can read the levels. Making or changing one needs the
// family PIN (the `guard`). This is mounted at /api/levels.

"use strict";

const express = require("express");
const { LEVELS_FILE, readJson, writeJsonWithBackup, nextId, indexById } = require("../lib/storage");
const { validateLevel } = require("../lib/validate");
const { guard } = require("../lib/auth");

const router = express.Router();

// Everyone can read all the levels.
router.get("/", (req, res) => {
  res.json(readJson(LEVELS_FILE));
});

// Make a brand-new level (the server picks its id).
router.post("/", guard, (req, res) => {
  let clean;
  try { clean = validateLevel(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const levels = readJson(LEVELS_FILE);
  const level = { id: nextId(levels), ...clean, updatedAt: new Date().toISOString() };
  levels.push(level);
  writeJsonWithBackup(LEVELS_FILE, levels);
  res.status(201).json(level);
});

// Change the order of the levels. The tablet sends the full list of level ids
// in the new order; we rewrite levels.json to match. (This route must come
// before "/:id" below, or ":id" would grab the word "order".)
router.put("/order", guard, (req, res) => {
  const order = req.body && req.body.order;
  const levels = readJson(LEVELS_FILE);
  // The new order must list exactly the ids we already have, each one once.
  if (!Array.isArray(order) || order.length !== levels.length) {
    return res.status(400).json({ error: "That new order doesn't match the levels." });
  }
  const byId = new Map(levels.map(L => [Number(L.id), L]));
  const reordered = [];
  for (const id of order) {
    const L = byId.get(Number(id));
    if (!L || reordered.includes(L)) {
      return res.status(400).json({ error: "That new order doesn't match the levels." });
    }
    reordered.push(L);
  }
  writeJsonWithBackup(LEVELS_FILE, reordered);
  res.json(reordered);
});

// Save changes to one level.
router.put("/:id", guard, (req, res) => {
  let clean;
  try { clean = validateLevel(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const id = Number(req.params.id);
  const levels = readJson(LEVELS_FILE);
  const i = indexById(levels, id);
  if (i === -1) return res.status(404).json({ error: "That level does not exist." });

  levels[i] = { id, ...clean, updatedAt: new Date().toISOString() };
  writeJsonWithBackup(LEVELS_FILE, levels);
  res.json(levels[i]);
});

// Delete one level.
router.delete("/:id", guard, (req, res) => {
  const id = Number(req.params.id);
  const levels = readJson(LEVELS_FILE);
  const i = indexById(levels, id);
  if (i === -1) return res.status(404).json({ error: "That level does not exist." });

  const [removed] = levels.splice(i, 1);
  writeJsonWithBackup(LEVELS_FILE, levels);
  res.json(removed);
});

module.exports = router;
