// ============================================================
// migrate.js — the one-time move from "players" to "accounts".
// ============================================================
// Hyper Hop used to have data/profiles.json: just a name and a cube,
// no password, no coins. Now it has data/accounts.json, where every
// player can log in and has a purse. This file does that move ONCE,
// the first time the new server starts, and then never again.
//
// The important promise: NOBODY LOSES ANYTHING. Every name we can
// find — in the old players file, on the high-score board, or on a
// level somebody made — becomes an account, keeping its cube, its
// scores and its levels. Those accounts start with no password, so
// the first time a kid taps their name the game says "pick a
// password" and it becomes theirs.

"use strict";

const fs = require("fs");
const path = require("path");
const {
  PROFILES_FILE, LEVELS_FILE, SCORES_FILE, ACCOUNTS_FILE, META_FILE,
  BACKUP_DIR, readJson, writeJsonWithBackup, safeTimestamp,
} = require("./storage");
const { cleanSkin } = require("./validate");
const { getPrices } = require("./prices");

// The first grown-up. Everybody else starts as a "player". Change
// anybody's job later by editing data/accounts.json by hand.
const FIRST_ADMIN_NAME = "Nick";

// Levels that came with the game aren't "made by" a real person.
const BUILT_IN_AUTHOR = "built-in";

function migrate() {
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
      bountiesPaid: 0,          // filled in below, once we know who owns what
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

  // Levels somebody already made count as already paid for. We're not
  // handing out backdated bounties for old levels — and this also
  // means nobody can delete their old levels and "re-make" them for
  // coins. From here on, only genuinely new levels pay.
  for (const account of accounts) {
    account.bountiesPaid = levels.filter(L => Number(L.ownerId) === Number(account.id)).length;
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

module.exports = { migrate, FIRST_ADMIN_NAME };
