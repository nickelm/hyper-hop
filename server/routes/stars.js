// ============================================================
// routes/stars.js — "I like this one!" ⭐
// ============================================================
// One star per person per level, and you can take it back by tapping
// again. That's the whole thing.
//
// Three things it deliberately is NOT:
//   * there is no thumbs-DOWN. Somebody spent an afternoon on that
//     level; the worst it can get from us is no stars.
//   * a star is worth no coins at all, and never touches the trophy
//     board. If stars paid, kids would trade them instead of meaning
//     them.
//   * starring your own level is allowed. Of course you like it, you
//     made it — and policing that would cost more code than it saves.
//
// Mounted at /api/stars.

"use strict";

const express = require("express");
const { STARS_FILE, LEVELS_FILE, readJson, updateJson } = require("../lib/storage");
const { guard, can, visibleTo } = require("../lib/auth");
const { NotFound, NotAllowed } = require("../lib/errors");

const router = express.Router();

// Everybody's stars, so a tablet can count them. (The level list
// already carries the counts, so the game rarely needs this — it's here
// because reading is always open.)
router.get("/", (req, res) => {
  res.json(readJson(STARS_FILE));
});

/* ---------------- Star / unstar one level ----------------
   Tapping ⭐ sends this; we answer with what the button should now say,
   so the tablet never has to guess. */
router.post("/:levelId", guard, (req, res) => {
  const levelId = Number(req.params.levelId);
  const me = req.account;

  try {
    if (!can(me, "level.star")) {
      throw new NotAllowed("You can't star levels right now.");
    }
    // You can only star a level you're allowed to see. (Nobody can star
    // somebody else's private draft — they shouldn't know it exists.)
    const level = readJson(LEVELS_FILE).find(L => Number(L.id) === levelId);
    if (!level) throw new NotFound("That level does not exist.");
    if (!visibleTo(level, me)) throw new NotFound("That level does not exist.");

    const result = updateJson(STARS_FILE, stars => {
      const at = stars.findIndex(s =>
        Number(s.levelId) === levelId && Number(s.accountId) === Number(me.id));
      if (at === -1) {
        stars.push({ levelId, accountId: me.id, at: new Date().toISOString() });
      } else {
        stars.splice(at, 1);           // tapped again = changed your mind
      }
      const starCount = stars.filter(s => Number(s.levelId) === levelId).length;
      return { starred: at === -1, starCount };
    });

    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

module.exports = router;
