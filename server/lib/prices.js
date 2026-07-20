// ============================================================
// prices.js — the shop's price list.
// ============================================================
// How much everything costs lives in data/prices.json. A grown-up can
// open that file, change a number, save it — and the shop notices
// straight away, no restarting needed. (We check the file's "last
// changed" time; if it hasn't changed we reuse the prices we already
// read, so this is cheap enough to call on every single request.)
//
// Why here and not in config.js with all the other numbers? Because
// config.js is sent to the tablets, and a clever kid could change it
// in their browser and hand themselves a million coins. Prices have
// to be the SERVER's business.

"use strict";

const fs = require("fs");
const { PRICES_FILE, DEFAULT_PRICES } = require("./storage");

let remembered = null;
let rememberedAt = -1;

function getPrices() {
  let changedAt;
  try { changedAt = fs.statSync(PRICES_FILE).mtimeMs; }
  catch (e) { return DEFAULT_PRICES; }        // no file yet? normal prices.

  if (remembered && changedAt === rememberedAt) return remembered;

  let fromFile = {};
  try {
    fromFile = JSON.parse(fs.readFileSync(PRICES_FILE, "utf8"));
  } catch (e) {
    console.warn("data/prices.json looks broken — using the normal prices for now.");
    fromFile = {};
  }
  // Anything the file leaves out falls back to the normal price, so a
  // half-finished edit can never make something cost "undefined".
  remembered = { ...DEFAULT_PRICES, ...fromFile };
  remembered.skin = { ...DEFAULT_PRICES.skin, ...(fromFile.skin || {}) };
  rememberedAt = changedAt;
  return remembered;
}

module.exports = { getPrices };
