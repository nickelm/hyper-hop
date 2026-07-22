// ============================================================
// names.js — the 🎲 dice that names a level for you.
// ============================================================
// Every level needs its own name, and thinking one up is the boring
// bit. Tap the dice and it sticks a describing word onto a place word:
// "Turbo Canyon", "Wobbly Dungeon", "Frozen Skyway".
//
// The words themselves live on the server (server/lib/words.js) so
// there is only ever ONE list of them. We fetch it once when the game
// starts. Want to add your own words? That's the file to open.

import { apiGet } from "./api.js";

// The words we downloaded. Until they arrive we use the little list
// below, so the dice always does SOMETHING even if the server is slow.
let WORDS = {
  adjectives: ["Bouncy", "Turbo", "Sneaky", "Wobbly", "Hyper", "Golden"],
  nouns: ["Alley", "Castle", "Canyon", "Maze", "Rush", "Tower"],
};

// How many goes we have at a name nobody is using before we give up
// and put a number on the end. (The server does exactly the same.)
const TRIES = 20;

// Fetch the word lists once at start-up. If it fails we simply keep the
// little list above — a dice that gives slightly samey names is much
// better than a dice that doesn't work.
export async function loadWords() {
  try {
    const fromServer = await apiGet("/words");
    if (fromServer && fromServer.adjectives && fromServer.nouns) WORDS = fromServer;
  } catch (e) { /* keep the small list */ }
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/* ----------------------------------------------------------------
   ROLL A NAME NOBODY IS USING. `taken` is every level name there is,
   so the dice never hands you one that's already spoken for — the
   server would only refuse it. If we somehow can't find a free one we
   count upwards ("Turbo Canyon 2"), so this ALWAYS answers.
   ---------------------------------------------------------------- */
export function rollLevelName(taken) {
  const used = new Set([...(taken || [])].map(n => String(n).trim().toLowerCase()));
  let name = "";
  for (let go = 0; go < TRIES; go++) {
    name = pick(WORDS.adjectives) + " " + pick(WORDS.nouns);
    if (!used.has(name.toLowerCase())) return name;
  }
  for (let n = 2; ; n++) {
    const numbered = name + " " + n;
    if (!used.has(numbered.toLowerCase())) return numbered;
  }
}
