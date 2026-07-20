// ============================================================
// errors.js — two kinds of "no".
// ============================================================
// Everywhere else in the server, when something is wrong we just
// `throw new Error("a friendly message")` and the route turns it into
// a 400 ("you sent something odd"). Sometimes we need to say one of
// two other things instead:
//
//   NotFound   404 — there's nothing here by that name
//   NotAllowed 403 — it's there, but it isn't yours to touch
//
// Each one carries its own number, so a route can say
// `res.status(e.status || 400)` and always get it right.

"use strict";

class NotFound extends Error {
  constructor(message) { super(message); this.status = 404; }
}

class NotAllowed extends Error {
  constructor(message) { super(message); this.status = 403; }
}

module.exports = { NotFound, NotAllowed };
