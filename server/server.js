/* ================================================================
   server.js — Hyper Hop's tiny family server (the front door)
   ================================================================
   A small Node + Express app. It does three jobs:

     1. Serves the game (the files in ../public) to any tablet.
     2. Keeps everyone's levels, settings, scores, and players in
        flat JSON files in ../data  (no database — just files!).
        All the file work lives in lib/storage.js.
     3. Guards every change with a family PIN (lib/auth.js) and
        checks everything a tablet sends (lib/validate.js).

   The actual endpoints live in routes/. This file just wires them
   together and starts listening.

   Run it like this:
       npm install
       FAMILY_PIN=1234 node server/server.js
   Then open http://localhost:3000

   Settings you can pass in the environment:
       PORT        which port to listen on   (default 3000)
       FAMILY_PIN  the secret the kids type to save (default "1234" for
                   local testing — ALWAYS set a real one in production)
       READ_ONLY   "true" freezes all editing (a friendly "no" to writes)
   ================================================================ */

"use strict";

const express = require("express");
const path = require("path");

const { ensureData } = require("./lib/storage");
const { READ_ONLY } = require("./lib/auth");
const levelsRoutes = require("./routes/levels");
const settingsRoutes = require("./routes/settings");
const scoresRoutes = require("./routes/scores");
const profilesRoutes = require("./routes/profiles");

const PORT = process.env.PORT || 3000;

// Make sure the data files exist (seeding the starter levels the first time).
ensureData();

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
app.use("/api/levels", levelsRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/scores", scoresRoutes);
app.use("/api/profiles", profilesRoutes);

app.listen(PORT, () => {
  console.log("Hyper Hop is running →  http://localhost:" + PORT);
  if (READ_ONLY) console.log("READ_ONLY is on: editing is frozen.");
});
