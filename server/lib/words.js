// ============================================================
// words.js — the level-name dice. 🎲
// ============================================================
// Every level needs its own name, and thinking one up is the boring
// bit. So the editor has a dice button: it takes one word from each of
// the two lists below and sticks them together — "Turbo Canyon",
// "Wobbly Dungeon", "Frozen Skyway".
//
// ADD YOUR OWN WORDS! Just put them in the lists, keep the quotes and
// the commas, and save. The tablets pick the new words up the next
// time the server starts (the game asks for them at /api/words).
//
// Two rules for a good word: keep it short, and make sure it sounds
// right whichever word from the other list it lands next to.

"use strict";

// Describing words — these go FIRST.
const ADJECTIVES = [
  "Bouncy", "Spiked", "Turbo", "Sneaky", "Mega", "Wobbly",
  "Frozen", "Golden", "Hyper", "Sleepy", "Upside-Down", "Rainbow",
  "Grumpy", "Zappy", "Midnight", "Bubbly", "Rusty", "Cosmic",
  "Silly", "Thunder", "Tiny", "Haunted",
];

// Place words — these go SECOND.
const NOUNS = [
  "Alley", "Madhouse", "Cylinder", "Castle", "Canyon", "Factory",
  "Volcano", "Skyway", "Dungeon", "Jungle", "Maze", "Rush",
  "Tower", "Cavern", "Bridge", "Harbour", "Workshop", "Swamp",
  "Rooftop", "Tunnel", "Island", "Laboratory",
];

// How many goes we have at finding a name nobody has used yet before
// we give up and stick a number on the end.
const TRIES = 20;

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/* ----------------------------------------------------------------
   A FRESH NAME NOBODY IS USING. `taken` is every level name there is
   (any list of strings will do). We roll the dice up to TRIES times
   hoping for a name that's free; if the lists are somehow all used up
   we keep the last roll and count upwards — "Turbo Canyon 2" — so this
   ALWAYS answers with a name, and never spins forever.
   ---------------------------------------------------------------- */
function randomLevelName(taken) {
  const used = new Set([...(taken || [])].map(n => String(n).trim().toLowerCase()));
  let name = "";
  for (let go = 0; go < TRIES; go++) {
    name = pick(ADJECTIVES) + " " + pick(NOUNS);
    if (!used.has(name.toLowerCase())) return name;
  }
  // Every name we tried is taken. Add a number until one is free.
  for (let n = 2; ; n++) {
    const numbered = name + " " + n;
    if (!used.has(numbered.toLowerCase())) return numbered;
  }
}

module.exports = { ADJECTIVES, NOUNS, randomLevelName };
