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

// What we know right now. `prices` arrives from the server; until it
// does, everything shows as free rather than as a wrong number.
const WALLET = {
  balance: 0,
  earnedTotal: 0,
  collectedByLevel: {},     // { levelId: ["col,row", ...] } — coins already paid for
  prices: null,
};

let announce = () => {};    // main.js gives us a "the purse changed" callback

export function initEconomy({ onBalanceChanged } = {}) {
  if (onBalanceChanged) announce = onBalanceChanged;
}

// Take in whatever /api/me said about us.
export function setWalletFromMe(me) {
  WALLET.balance = (me && me.coins) || 0;
  WALLET.earnedTotal = (me && me.coinsEarnedTotal) || 0;
  WALLET.collectedByLevel = (me && me.collectedCoins) || {};
  announce();
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
   ---------------------------------------------------------------- */
export async function reportRun(levelId, coinKeys, completed) {
  if (levelId == null) return 0;              // a test run — never counts
  try {
    const answer = await apiPost("/runs", {
      levelId,
      collectedCoinKeys: [...coinKeys],
      completed: !!completed,
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
    announce();
    return answer.credited || 0;
  } catch (e) {
    return 0;            // a lost coin report is no big deal — keep playing
  }
}

/* ----------------------------------------------------------------
   WHAT WOULD THIS CUBE COST? We compare the cube you're building with
   the one that's saved, part by part. Only the parts that actually
   CHANGED cost anything — so keeping the classic green cube, or
   changing your mind back, is always free.

   The server works this out again for real when you save. This copy
   is only so the button can say the price before you tap it.
   ---------------------------------------------------------------- */
export function skinCost(savedSkin, newSkin) {
  const prices = WALLET.prices && WALLET.prices.skin;
  if (!prices || !newSkin) return { items: [], total: 0 };
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
