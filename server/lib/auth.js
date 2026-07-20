// ============================================================
// auth.js — the "are you allowed to change things?" guards.
// ============================================================
// Reading is always open. CHANGING anything (levels, settings,
// players) needs the family PIN, and everything is frozen when
// READ_ONLY is on. These two little middlewares enforce that; put
// `guard` in front of a route and it's protected.

"use strict";

const READ_ONLY = process.env.READ_ONLY === "true";

let FAMILY_PIN = process.env.FAMILY_PIN;
if (!FAMILY_PIN) {
  FAMILY_PIN = "1234";
  console.warn(
    "\n  ⚠  FAMILY_PIN is not set — using the test PIN \"1234\".\n" +
    "     Set a real one before deploying:  FAMILY_PIN=your-secret node server/server.js\n"
  );
}

// Freeze switch: when READ_ONLY is on, politely refuse every change.
function notFrozen(req, res, next) {
  if (READ_ONLY) {
    return res.status(403).json({ error: "Editing is frozen right now. 🧊" });
  }
  next();
}

// The family PIN: the tablet must send the right secret to save anything.
function requirePin(req, res, next) {
  const pin = req.get("X-Family-Pin");
  if (pin !== FAMILY_PIN) {
    return res.status(401).json({ error: "Wrong family PIN — ask a grown-up!" });
  }
  next();
}

// Every mutating route uses both guards, in this order.
const guard = [notFrozen, requirePin];

module.exports = { READ_ONLY, notFrozen, requirePin, guard };
