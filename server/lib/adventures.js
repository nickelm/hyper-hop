// ============================================================
// adventures.js — how far have you got through an adventure?
// ============================================================
// An ADVENTURE is a list of levels a curator has put in an order:
// "Beginner's Luck" might be five easy levels, gentlest first. You play
// them in that order, and you can't skip ahead — beat one and the next
// one unlocks.
//
// Two little sums decide everything, and they are worked out FRESH
// every time somebody asks. Nothing is stored except the plain set of
// levels each person has beaten, which is why a curator can rearrange
// an adventure whenever they like and everybody's progress just
// quietly rearranges itself to match.
//
//   SCORE     how many of this adventure's levels you have beaten.
//             Take a level out of the adventure and everyone who beat
//             it scores one less; put it back and it returns. Nothing
//             to fix up, because nothing was ever written down.
//
//   FRONTIER  how far along you're allowed to be. It's the length of
//             the run of levels from the START that you have beaten,
//             with no gaps — so you may play everything you've already
//             done, plus the very next one, and nothing beyond.
//
// The nice thing about the frontier being a plain "how many from the
// start" is what happens when a curator drops a new level into the
// MIDDLE. Everybody's run-from-the-start now stops at the new level,
// so everybody has to play it next. That isn't special code — it's
// just what the rule says.

"use strict";

/* ----------------------------------------------------------------
   THE LEVELS OF THIS ADVENTURE YOU CAN ACTUALLY PLAY RIGHT NOW.
   A level that was deleted, or that a curator has hidden, is SKIPPED
   rather than blocking the way: an adventure must never become
   impossible because one of its levels went away.
   ---------------------------------------------------------------- */
function playableIds(adventure, levels) {
  const byId = new Map(levels.map(L => [Number(L.id), L]));
  return (adventure.levelIds || [])
    .map(Number)
    .filter(id => {
      const L = byId.get(id);
      return !!L && (L.status || "listed") === "listed";
    });
}

// Which of this adventure's levels has this player beaten? (An account
// from before adventures existed simply hasn't beaten any.)
function completedIn(account, adventureId) {
  const all = (account && account.adventureProgress) || {};
  return new Set((all[String(adventureId)] || []).map(Number));
}

// How many of the adventure's levels you've beaten. Counted against
// the adventure as it is RIGHT NOW, hidden ones included — you did beat
// them, after all.
function scoreOf(adventure, completed) {
  return (adventure.levelIds || []).filter(id => completed.has(Number(id))).length;
}

/* ----------------------------------------------------------------
   HOW FAR ALONG YOU MAY GO: the number of levels you've beaten in one
   unbroken run from the beginning. That is also the position of the
   level you're allowed to play next, which is why one number does both
   jobs.
   ---------------------------------------------------------------- */
function frontierOf(open, completed) {
  let at = 0;
  while (at < open.length && completed.has(Number(open[at]))) at++;
  return at;
}

// May this player have a go at this level in this adventure?
// Everything up to and including the frontier; nothing past it.
function mayPlay(adventure, levels, account, levelId) {
  const open = playableIds(adventure, levels);
  const where = open.findIndex(id => Number(id) === Number(levelId));
  if (where === -1) return false;                 // not in this adventure (any more)
  return where <= frontierOf(open, completedIn(account, adventure.id));
}

/* ----------------------------------------------------------------
   ONE ADVENTURE, AS A TABLET SHOULD SEE IT: the adventure itself plus
   what THIS player has done with it — which levels they've beaten,
   how far they may go, and their score out of the total.
   ---------------------------------------------------------------- */
function adventureForTablet(adventure, levels, account) {
  const open = playableIds(adventure, levels);
  const completed = completedIn(account, adventure.id);
  return {
    ...adventure,
    playableIds: open,
    completed: [...completed],
    frontier: frontierOf(open, completed),
    score: scoreOf(adventure, completed),
    total: (adventure.levelIds || []).length,
  };
}

module.exports = {
  playableIds, completedIn, scoreOf, frontierOf, mayPlay, adventureForTablet,
};
