/* ================================================================
   server.js — Hyper Hop's tiny family server (the front door)
   ================================================================
   A small Node + Express app. It does three jobs:

     1. Serves the game (the files in ../public) to any tablet.
     2. Keeps everyone's levels, scores, players and coins
        in flat JSON files in ../data  (no database — just files!).
        All the file work lives in lib/storage.js.
     3. Works out who is logged in and what they're allowed to change
        (lib/auth.js), and checks everything a tablet sends
        (lib/validate.js).

   The actual endpoints live in routes/. This file just wires them
   together and starts listening.

   Run it like this:
       npm install
       npm start
   Then open http://localhost:3000

   There is no server password to set any more: everybody has their
   own account and picks their own password the first time they play.

   Settings you can pass in the environment:
       PORT       which port to listen on   (default 3000)
       READ_ONLY  "true" freezes all editing (a friendly "no" to
                  writes). Playing and logging in still work.
   ================================================================ */

"use strict";

const express = require("express");
const path = require("path");

const { ensureData } = require("./lib/storage");
const { migrate } = require("./lib/migrate");
const { READ_ONLY } = require("./lib/auth");
const authRoutes = require("./routes/auth");
const levelsRoutes = require("./routes/levels");
const scoresRoutes = require("./routes/scores");
const accountsRoutes = require("./routes/accounts");
const runsRoutes = require("./routes/runs");
const leaderboardRoutes = require("./routes/leaderboard");
const pricesRoutes = require("./routes/prices");

const PORT = process.env.PORT || 3000;

// Make sure the data files exist (seeding the starter levels the first time),
// then do the one-time move from the old players file to accounts.
ensureData();
migrate();

const app = express();
app.use(express.json({ limit: "256kb" }));

// Serve the game. The code modules in public/js/ get a "no-cache" header so a
// tablet always re-checks for new code on refresh — otherwise iPads happily
// keep running yesterday's game. (Plain files like index.html cache normally.)
const publicDir = path.join(__dirname, "..", "public");
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    const jsFolder = path.sep + "js" + path.sep;
    if (filePath.includes(jsFolder)) res.setHeader("Cache-Control", "no-cache");
  },
}));

// ---------- The API ----------
// Logging in and out lives at the top level (/api/me, /api/login, …),
// so this one is mounted on plain "/api".
app.use("/api", authRoutes);
app.use("/api/levels", levelsRoutes);
app.use("/api/scores", scoresRoutes);
app.use("/api/accounts", accountsRoutes);
app.use("/api/runs", runsRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/prices", pricesRoutes);

// An /api address nobody knows should still answer with JSON. Without
// this it falls through to the static files and comes back as a page
// of HTML, which makes the game's error messages very confusing.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "There's nothing at " + req.originalUrl + "." });
});

// The last line of defence: if anything at all goes wrong, say so in
// JSON (and in a way a kid can read) instead of a wall of red text.
app.use((err, req, res, next) => {
  console.error("Something went wrong handling " + req.method + " " + req.originalUrl + ":", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: "The game server got confused. Try again! 😅" });
});

app.listen(PORT, () => {
  console.log("Hyper Hop is running →  http://localhost:" + PORT);
  if (READ_ONLY) console.log("READ_ONLY is on: editing is frozen.");
});
