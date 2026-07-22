// ============================================================
// migrate.js — the one-time tidy-ups, done at start-up.
// ============================================================
// Two of them, each done ONCE and then never again:
//
//   1. players → accounts. Hyper Hop used to have data/profiles.json:
//      just a name and a cube, no password, no coins. Now it has
//      data/accounts.json, where every player can log in and has a
//      purse.
//   2. levels → the level lifecycle. Levels used to be either there or
//      not there. Now every level is a draft, listed or hidden, and no
//      two levels may share a name.
//
// The important promise for both: NOBODY LOSES ANYTHING. Every name we
// can find — in the old players file, on the high-score board, or on a
// level somebody made — becomes an account, keeping its cube, its
// scores and its levels. Those accounts start with no password, so
// the first time a kid taps their name the game says "pick a
// password" and it becomes theirs. And every level that already
// existed becomes a LISTED one, so nothing a kid made disappears.

"use strict";

const fs = require("fs");
const path = require("path");
const {
  PROFILES_FILE, LEVELS_FILE, SCORES_FILE, ACCOUNTS_FILE, META_FILE,
  BACKUP_DIR, readJson, writeJsonWithBackup, safeTimestamp,
} = require("./storage");
const { cleanSkin } = require("./validate");
const { getPrices } = require("./prices");
const { randomLevelName } = require("./words");

// The first grown-up. Everybody else starts as a "player". Change
// anybody's job later by editing data/accounts.json by hand.
const FIRST_ADMIN_NAME = "Nick";

// Levels that came with the game aren't "made by" a real person.
const BUILT_IN_AUTHOR = "built-in";

function migrateProfiles() {
  // ---- The one-way gate ----------------------------------------
  // Having even one saved account means we already did this. (The
  // file itself always exists — the first-run setup makes an empty
  // one — so "is it empty?" is the real question.) We save the
  // accounts near the LAST possible moment, so if anything goes wrong
  // halfway the gate stays open and the whole move simply tries again
  // next time instead of half-finishing.
  const existing = fs.existsSync(ACCOUNTS_FILE) ? readJson(ACCOUNTS_FILE) : [];
  if (existing.length) return;

  const oldPlayers = fs.existsSync(PROFILES_FILE) ? readJson(PROFILES_FILE) : [];
  const levels = readJson(LEVELS_FILE);
  const scores = readJson(SCORES_FILE);
  const prices = getPrices();
  const now = new Date().toISOString();

  /* ---- 1. Collect every name we can find -----------------------
     We match names ignoring capital letters (so "viggo" and "Viggo"
     are the same kid), but we keep the FIRST spelling we saw. */
  const found = new Map();          // lowercase name -> { name, id?, skin? }
  function remember(rawName, extra) {
    const name = String(rawName == null ? "" : rawName).trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (key === BUILT_IN_AUTHOR) return;          // not a person
    if (!found.has(key)) found.set(key, { name });
    Object.assign(found.get(key), extra || {});
  }

  for (const p of oldPlayers) remember(p.name, { id: p.id, skin: p.skin });
  for (const s of scores) remember(s.player);
  for (const L of levels) remember(L.author);

  /* ---- 2. Turn them into accounts ------------------------------
     Old players keep their exact id and cube, so their levels and
     scores still point at the right person. Everyone else gets a
     fresh id that can't clash with a kept one. */
  const keptIds = new Set([...found.values()].map(r => Number(r.id)).filter(Number.isFinite));
  let nextFreeId = (keptIds.size ? Math.max(...keptIds) : 0) + 1;

  const accounts = [...found.values()].map(record => {
    const id = Number.isFinite(Number(record.id)) ? Number(record.id) : nextFreeId++;
    const skin = cleanSkin(record.skin);     // no old cube? the classic green one
    return {
      id,
      name: record.name,
      passwordHash: null,          // null = nobody has claimed it yet
      role: record.name.toLowerCase() === FIRST_ADMIN_NAME.toLowerCase() ? "admin" : "player",
      extraPerms: [],
      skin,
      looks: [{ skin, name: "", from: "shop" }],   // the cube they already had is theirs to keep
      coins: prices.startingCoins,
      coinsEarnedTotal: 0,
      collectedCoins: {},
      adventureProgress: {},    // which levels of each adventure they've beaten
      createdAt: now,
      updatedAt: now,
    };
  });

  // A quick way to look up "who is this name?"
  const idByName = new Map(accounts.map(a => [a.name.toLowerCase(), a.id]));
  const whoIs = rawName => {
    const name = String(rawName == null ? "" : rawName).trim().toLowerCase();
    return (name && idByName.has(name)) ? idByName.get(name) : null;
  };

  /* ---- 3. Give every level an owner ---------------------------- */
  let owned = 0;
  for (const L of levels) {
    L.ownerId = whoIs(L.author);
    if (L.ownerId != null) owned++;
  }

  /* ---- 4. Tie every score to its player ------------------------
     We keep the name too, so an old score whose player we couldn't
     match still shows up on the board. */
  for (const s of scores) s.accountId = whoIs(s.player);

  /* ---- 5. Save. The ORDER matters -----------------------------
     Nothing here is destructive on its own, and the accounts (our
     gate) go in near the end — so a crash part-way leaves the gate
     open and next start-up simply does the whole move again. */
  if (!accounts.length) return;        // brand-new game: nothing to move at all

  writeJsonWithBackup(LEVELS_FILE, levels);
  writeJsonWithBackup(SCORES_FILE, scores);
  writeJsonWithBackup(ACCOUNTS_FILE, accounts);      // the gate closes here

  // Keep the old players file safe, then move it out of the way so
  // it's obvious it isn't used any more.
  if (fs.existsSync(PROFILES_FILE)) {
    fs.copyFileSync(PROFILES_FILE,
      path.join(BACKUP_DIR, "profiles.json." + safeTimestamp() + ".json"));
    fs.renameSync(PROFILES_FILE, PROFILES_FILE + ".migrated");
  }

  const meta = fs.existsSync(META_FILE) ? readJson(META_FILE) : {};
  const biggestLevelId = levels.reduce((m, L) => Math.max(m, Number(L.id) || 0), 0);
  meta.nextLevelId = Math.max(Number(meta.nextLevelId) || 1, biggestLevelId + 1);
  meta.migratedFromProfilesAt = now;
  writeJsonWithBackup(META_FILE, meta);

  const unclaimed = accounts.filter(a => a.passwordHash == null).length;
  console.log(
    "Moved " + accounts.length + " player(s) into data/accounts.json " +
    "(" + unclaimed + " still to claim a password, " + owned + " level(s) matched to an owner).\n" +
    "  Everyone taps their name and picks a password the first time they play."
  );
}

/* ================================================================
   =========  2. EVERY OLD LEVEL JOINS THE NEW LIFECYCLE  =========
   ================================================================
   Levels used to be simply "there". Now each one is a draft, listed
   or hidden, and no two may share a name. This gives the levels that
   already existed their place in that world, once:

     - they all become LISTED. They were already out there for
       everybody to play, and publishing is not something we can do on
       a kid's behalf (it costs coins), so nothing changes for anyone.
     - a level called "My Level" — the old default name, which lots of
       levels ended up sharing — gets a proper name from the dice.
     - any other clash keeps the FIRST level's name and renames the
       later ones, so the "one name, one level" rule starts out true.

   The gate is meta.json's levelsUpgradedAt, and it is written LAST —
   so a crash half-way just means we try the whole thing again next
   time rather than leaving the levels half-done.
   ================================================================ */
const OLD_DEFAULT_NAME = "my level";

function upgradeLevels() {
  const meta = fs.existsSync(META_FILE) ? readJson(META_FILE) : {};
  if (meta.levelsUpgradedAt) return;              // already done

  const levels = readJson(LEVELS_FILE);
  const now = new Date().toISOString();
  let renamed = 0;

  // Names we've already handed out, so a new one can't clash either.
  const taken = new Set();
  for (const L of levels) {
    if (!L.status) L.status = "listed";           // it was already playable by everyone
    if (L.bounty === undefined) L.bounty = null;  // and nobody had put a prize on it
    if (!L.createdAt) L.createdAt = L.updatedAt || now;

    const name = String(L.name || "").trim();
    const key = name.toLowerCase();
    // A level called "My Level" (or one whose name is already spoken
    // for) gets a fresh one from the dice.
    if (!name || key === OLD_DEFAULT_NAME || taken.has(key)) {
      L.name = randomLevelName(taken);
      renamed++;
    }
    taken.add(String(L.name).toLowerCase());
  }

  writeJsonWithBackup(LEVELS_FILE, levels);
  meta.levelsUpgradedAt = now;
  writeJsonWithBackup(META_FILE, meta);           // the gate closes here

  console.log("Levels upgraded: " + levels.length + " now listed" +
    (renamed ? ", " + renamed + " given a fresh name 🎲" : "") + ".");
}

// Both tidy-ups, in order. Each one decides for itself whether it has
// anything to do, so calling this on every start-up is free.
function migrate() {
  migrateProfiles();
  upgradeLevels();
}

module.exports = { migrate, migrateProfiles, upgradeLevels, FIRST_ADMIN_NAME };
