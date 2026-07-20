// ============================================================
// passwords.js — scrambling passwords so they can't be read.
// ============================================================
// We NEVER save the password you type. Instead we scramble it into a
// jumble of letters and save that. Next time you log in we scramble
// what you typed again and check the two jumbles match. That way even
// somebody who can read all our files still can't learn anybody's
// password.

"use strict";

const crypto = require("node:crypto");

// "scrypt" is a scrambler that is SLOW on purpose. A computer trying
// to guess millions of passwords a second gets stuck, but doing it
// once when you log in takes about a tenth of a second — you won't
// even notice. These numbers say how much work to do.
const WORK = 16384;      // the big one: 16384 * 8 * 128 = about 16 MB of puzzling
const BLOCKS = 8;
const PARALLEL = 1;
const JUMBLE_LENGTH = 32;

// Short passwords are fine here — this is a family game, not a bank,
// and a 9-year-old has to be able to remember it.
const MIN_PASSWORD = 4;

// Scramble a password into one line of text that ALSO remembers how it
// was scrambled, so we can still check old passwords even if we make
// the numbers above bigger one day:
//     scrypt$16384$8$1$<salt>$<jumble>
function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length < MIN_PASSWORD) {
    throw new Error("Your password needs at least " + MIN_PASSWORD + " letters or numbers.");
  }
  // A "salt" is a pinch of randomness, different for every player, so
  // two kids who pick the same password still get different jumbles.
  const salt = crypto.randomBytes(16);
  const jumble = crypto.scryptSync(plain, salt, JUMBLE_LENGTH,
    { N: WORK, r: BLOCKS, p: PARALLEL });
  return ["scrypt", WORK, BLOCKS, PARALLEL,
    salt.toString("base64"), jumble.toString("base64")].join("$");
}

// Does this password match the jumble we saved? We compare with
// timingSafeEqual, which always takes exactly the same amount of time
// — so a sneaky guesser can't learn anything from how fast we said no.
function checkPassword(plain, stored) {
  try {
    if (typeof plain !== "string" || typeof stored !== "string") return false;
    const [tag, work, blocks, parallel, salt, jumble] = stored.split("$");
    if (tag !== "scrypt") return false;
    const want = Buffer.from(jumble, "base64");
    const got = crypto.scryptSync(plain, Buffer.from(salt, "base64"), want.length,
      { N: Number(work), r: Number(blocks), p: Number(parallel) });
    // timingSafeEqual is grumpy about different lengths, so check first.
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch (e) {
    return false;          // a broken line in the file just means "no"
  }
}

module.exports = { hashPassword, checkPassword, MIN_PASSWORD };
