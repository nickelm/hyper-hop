// ============================================================
// economy.js — coins: your purse, and what things cost.
// ============================================================
// The SERVER owns your coins. This file just remembers what it told
// us, tells it when you finish a level, and works out shop prices so
// the Save button can show them before you tap.
//
// Nothing in here is the last word on anything: if this file and the
// server ever disagree, the server wins. That's on purpose — a purse
// you can edit isn't worth much.

import { apiGet, apiPost } from "./api.js";
import { sameSkin } from "./game/player.js";

// What we know right now. `prices` arrives from the server; until it
// does, everything shows as free rather than as a wrong number.
const WALLET = {
  balance: 0,
  earnedTotal: 0,
  collectedByLevel: {},     // { levelId: ["col,row", ...] } — coins already paid for
  looks: [],                // every cube you own: { skin, name, from } — see "My Looks"
  prices: null,
};

let announce = () => {};    // main.js gives us a "the purse changed" callback

export function initEconomy({ onBalanceChanged } = {}) {
  if (onBalanceChanged) announce = onBalanceChanged;
}

// Take in whatever /api/me said about us. This replaces EVERYTHING we
// know, so only ever hand it a player the server just sent us — never
// one built by hand out of bits, or the parts you didn't mention get
// quietly wiped (that's what setBalance below is for).
export function setWalletFromMe(me) {
  WALLET.balance = (me && me.coins) || 0;
  WALLET.earnedTotal = (me && me.coinsEarnedTotal) || 0;
  WALLET.collectedByLevel = (me && me.collectedCoins) || {};
  WALLET.looks = (me && me.looks) || [];
  announce();
}

/* ----------------------------------------------------------------
   JUST THE PURSE. When the server takes coins for something (publishing
   a level, putting up a prize) it tells us the new balance and nothing
   else — so we change the balance and nothing else.

   This exists because doing it with setWalletFromMe was a real bug:
   it would take the coins AND throw away which coins you'd collected
   and which cubes you own, so a level you'd already emptied went back
   to showing gold coins and a cube you owned asked to be paid for
   again.
   ---------------------------------------------------------------- */
export function setBalance(coins, earnedTotal) {
  if (Number.isFinite(coins)) WALLET.balance = coins;
  if (Number.isFinite(earnedTotal)) WALLET.earnedTotal = earnedTotal;
  announce();
}

/* ----------------------------------------------------------------
   MY LOOKS — every cube you own. You get one by buying it in the cube
   editor, or by finishing a level that has its own character.

   The point of the list is that owning something is FOREVER: putting
   an old cube back on never costs a coin. The server keeps the real
   list (server/lib/looks.js) and decides what you may wear for free;
   this copy is only so the Save button can say so before you tap it.
   ---------------------------------------------------------------- */
export function myLooks() { return WALLET.looks; }

// Have you got this cube already? (Then wearing it is free.)
export function ownLook(skin) {
  return WALLET.looks.some(look => sameSkin(look.skin, skin));
}

// Fetch the price list once at start-up. If it fails we simply have no
// prices, and the shop shows plain "Save" instead of a wrong number.
export async function loadPrices() {
  try { WALLET.prices = await apiGet("/prices"); }
  catch (e) { WALLET.prices = null; }
}

export function balance() { return WALLET.balance; }
export function earnedTotal() { return WALLET.earnedTotal; }

// Which coins in this level have you ALREADY been paid for? Those are
// drawn silver during a run, so you can see at a glance which ones
// still pay. (Grabbing them is still fun — just not profitable.)
export function alreadyEarned(levelId) {
  const list = WALLET.collectedByLevel[String(levelId)];
  return new Set(list || []);
}

/* ----------------------------------------------------------------
   TELL THE SERVER ABOUT A RUN. We send which coins we picked up and
   whether we reached the flag; the server decides what that's worth
   and sends back how many coins it actually paid ("credited"), which
   may be fewer than we collected — coins only ever pay once.

   Finishing is also how you win a level's look, how you win a prize
   somebody put on the level, and how the next level of an adventure
   unlocks. So the answer can carry an `unlocked` cube and a `bounty`
   as well, and we hand them all back together.
   ---------------------------------------------------------------- */
export async function reportRun(levelId, coinKeys, completed, adventureId) {
  // A test run from the editor never counts for anything.
  if (levelId == null) return { credited: 0, unlocked: null, bounty: 0 };
  try {
    const answer = await apiPost("/runs", {
      levelId,
      collectedCoinKeys: [...coinKeys],
      completed: !!completed,
      // Which adventure we're playing, if any. The server checks that we
      // were really allowed to be on this level before it counts.
      adventureId: adventureId != null ? adventureId : undefined,
    });
    WALLET.balance = answer.balance;
    WALLET.earnedTotal = answer.coinsEarnedTotal;
    if (completed && answer.credited > 0) {
      // Remember the newly-paid coins so a replay shows them silver
      // straight away, without asking the server again.
      const key = String(levelId);
      const known = new Set(WALLET.collectedByLevel[key] || []);
      for (const k of coinKeys) known.add(k);
      WALLET.collectedByLevel[key] = [...known];
    }
    // Won the level's cube? Put it straight into My Looks, so it's
    // already waiting for you in the cube editor.
    if (answer.unlocked && !ownLook(answer.unlocked.skin)) {
      WALLET.looks = [...WALLET.looks,
        { skin: answer.unlocked.skin, name: answer.unlocked.name, from: "level" }];
    }
    announce();
    return {
      credited: answer.credited || 0,
      unlocked: answer.unlocked || null,
      bounty: answer.bounty || 0,
    };
  } catch (e) {
    // A lost coin report is no big deal — keep playing.
    return { credited: 0, unlocked: null, bounty: 0 };
  }
}

/* ----------------------------------------------------------------
   WHAT WOULD THIS CUBE COST? We compare the cube you're building with
   the one that's saved, part by part. Only the parts that actually
   CHANGED cost anything — so keeping the classic green cube, or
   changing your mind back, is always free.

   And a look you ALREADY OWN is free whatever it looks like: you
   bought that one once (or a level gave it to you), so it's yours.

   The server works this out again for real when you save. This copy
   is only so the button can say the price before you tap it.
   ---------------------------------------------------------------- */
export function skinCost(savedSkin, newSkin) {
  const prices = WALLET.prices && WALLET.prices.skin;
  if (!prices || !newSkin) return { items: [], total: 0 };
  if (ownLook(newSkin)) return { items: [], total: 0 };
  const items = [];
  let total = 0;
  for (const part of Object.keys(prices)) {
    if (newSkin[part] !== (savedSkin || {})[part]) {
      items.push({ part, price: prices[part] });
      total += prices[part];
    }
  }
  return { items, total };
}

// Do we even know the prices yet?
export function havePrices() { return !!(WALLET.prices && WALLET.prices.skin); }

// The most coins one level may hold. The editor uses this to keep a level
// inside the limit while you draw. If we couldn't reach the server we guess
// the normal 25 — the server checks again for real when you save, so a wrong
// guess here can never sneak an over-full level through.
const DEFAULT_MAX_COINS = 25;
export function maxCoinsPerLevel() {
  const most = WALLET.prices && WALLET.prices.maxCoinsPerLevel;
  return Number.isFinite(most) ? most : DEFAULT_MAX_COINS;
}

/* ----------------------------------------------------------------
   WHAT IT COSTS TO SHOW A LEVEL TO EVERYBODY. Making levels is free;
   publishing one is the thing you spend coins on. As always the server
   is what really charges — this is so the button can say the price
   before you tap it.
   ---------------------------------------------------------------- */
const DEFAULT_PUBLISH_FEE = 15;
export function publishFee() {
  const fee = WALLET.prices && WALLET.prices.publishFee;
  return Number.isFinite(fee) ? fee : DEFAULT_PUBLISH_FEE;
}

// How big a prize may be, and how many people one prize pays. The
// slider in the bounty pop-up uses these for its two ends.
const DEFAULT_BOUNTY = { min: 5, max: 100, slots: 3 };
export function bountyBounds() {
  const p = WALLET.prices || {};
  return {
    min: Number.isFinite(p.bountyMin) ? p.bountyMin : DEFAULT_BOUNTY.min,
    max: Number.isFinite(p.bountyMax) ? p.bountyMax : DEFAULT_BOUNTY.max,
    slots: Number.isFinite(p.bountySlots) ? p.bountySlots : DEFAULT_BOUNTY.slots,
  };
}
