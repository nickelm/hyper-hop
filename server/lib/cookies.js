// ============================================================
// cookies.js — the little note the browser keeps for us.
// ============================================================
// When you log in, the server gives your browser a secret note called
// a "cookie". The browser sends it back with every single request, so
// the server knows it's still you without asking again. This file is
// just the reading and writing of that note — done by hand, because
// Hyper Hop only allows itself one grown-up library (Express).

"use strict";

const SESSION_COOKIE = "hh_session";
const NINETY_DAYS = 90 * 24 * 60 * 60;      // in seconds — how long a login lasts

// Find one cookie in the "Cookie:" line the browser sends us. That
// line looks like   a=1; b=2; hh_session=abc   so we chop it up at
// the semicolons and then at the first equals sign.
function readCookie(req, name) {
  const line = req.headers.cookie;
  if (!line) return null;
  for (const piece of line.split(";")) {
    const equals = piece.indexOf("=");
    if (equals < 0) continue;
    if (piece.slice(0, equals).trim() !== name) continue;
    try { return decodeURIComponent(piece.slice(equals + 1).trim()); }
    catch (e) { return null; }               // a mangled cookie is no cookie
  }
  return null;
}

// Ask the browser to remember a cookie. The extra words matter:
//   HttpOnly     the game's own JavaScript CAN'T read it, so a nasty
//                script sneaked onto the page can't steal your login
//   SameSite=Lax another website can't use your cookie to pretend to be you
//   Secure       only send it over https (we skip this at home on plain http,
//                or the cookie would never be sent at all)
//   Path=/       the note counts for the whole game
function setCookie(res, req, name, value, maxAgeSeconds) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const bits = [
    name + "=" + encodeURIComponent(value),
    "Path=/", "HttpOnly", "SameSite=Lax",
    "Max-Age=" + maxAgeSeconds,
  ];
  if (isHttps) bits.push("Secure");
  // append (not set) so we never trample another Set-Cookie header.
  res.append("Set-Cookie", bits.join("; "));
}

// Throw the note away: same cookie, but it expires immediately.
function clearCookie(res, req, name) {
  setCookie(res, req, name, "", 0);
}

module.exports = { SESSION_COOKIE, NINETY_DAYS, readCookie, setCookie, clearCookie };
