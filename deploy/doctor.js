/* ================================================================
   doctor.js — "why isn't it working?"
   ================================================================
   A read-only health check for a Hyper Hop server. It changes
   NOTHING — it just looks at the data folder and asks the running
   server a few questions, then tells you what looks wrong.

   Run it from the project folder, as the user the game runs as:

       cd /opt/hyper-hop
       sudo -u hyperhop node deploy/doctor.js

   If the game is on a port other than 3000, say so:

       sudo -u hyperhop PORT=8080 node deploy/doctor.js
   ================================================================ */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const PORT = process.env.PORT || 3000;

let problems = 0;
const ok = m => console.log("  ok    " + m);
const bad = m => { problems++; console.log("  PROBLEM  " + m); };
const note = m => console.log("        " + m);

console.log("\n=== Hyper Hop doctor ===\n");

/* ---------- 1. Node ---------- */
console.log("Node");
const major = Number(process.versions.node.split(".")[0]);
if (major >= 16) ok("node " + process.version);
else bad("node " + process.version + " is too old — the login code needs 16 or newer.");

/* ---------- 2. Is the code actually the new code? ---------- */
console.log("\nCode");
const mustExist = [
  "server/lib/auth.js", "server/lib/migrate.js", "server/lib/sessions.js",
  "server/lib/passwords.js", "server/lib/cookies.js", "server/routes/auth.js",
  "server/routes/runs.js", "server/routes/accounts.js",
  "public/js/ui/login.js", "public/js/economy.js",
];
const missing = mustExist.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (!missing.length) ok("all the accounts/coins files are here");
else {
  bad("these files are MISSING — the pull didn't bring everything:");
  missing.forEach(f => note("- " + f));
  note("Fix: check `git log --oneline -1` and `git status` in " + ROOT);
}
if (fs.existsSync(path.join(ROOT, "server/routes/profiles.js"))) {
  bad("server/routes/profiles.js still exists — this is the OLD code.");
  note("Fix: git pull again; the deploy didn't take.");
}

/* ---------- 3. The data folder ---------- */
console.log("\nData folder (" + DATA + ")");
if (!fs.existsSync(DATA)) {
  bad("there is no data/ folder at all — the server has never started here.");
} else {
  const me = typeof os.userInfo === "function" ? os.userInfo() : null;
  if (me) note("running as: " + me.username + " (uid " + me.uid + ")");

  // Can we actually write here? This is the classic droplet problem:
  // the files end up owned by root and the game user can't touch them.
  try {
    const probe = path.join(DATA, ".doctor-probe");
    fs.writeFileSync(probe, "x");
    fs.unlinkSync(probe);
    ok("this user can write to data/");
  } catch (e) {
    bad("this user CANNOT write to data/ (" + e.code + ").");
    note("That alone breaks logging in, saving and coins.");
    note("Fix: sudo chown -R hyperhop:hyperhop " + DATA);
  }

  for (const f of ["levels.json", "accounts.json", "sessions.json", "prices.json", "meta.json"]) {
    const full = path.join(DATA, f);
    if (!fs.existsSync(full)) { bad(f + " is missing"); continue; }
    try {
      JSON.parse(fs.readFileSync(full, "utf8"));
      const st = fs.statSync(full);
      ok(f + "  (" + st.size + " bytes, uid " + st.uid + ")");
    } catch (e) {
      bad(f + " is not valid JSON — the server can't read it. " + e.message);
      note("Fix: restore it from " + path.join(DATA, "backups"));
    }
  }
}

/* ---------- 4. Did the move to accounts happen? ---------- */
console.log("\nAccounts");
let accounts = null;
try {
  accounts = JSON.parse(fs.readFileSync(path.join(DATA, "accounts.json"), "utf8"));
} catch (e) {
  bad("can't read accounts.json, so nobody can log in.");
  note("If the game has never started since the update, that's the reason:");
  note("Fix: systemctl restart hyper-hop, then read: journalctl -u hyper-hop -n 30");
}

if (accounts) {
  if (!accounts.length) {
    bad("accounts.json is EMPTY — nobody can log in.");
    const oldFile = path.join(DATA, "profiles.json");
    if (fs.existsSync(oldFile)) {
      note("profiles.json is still there, so the one-time move hasn't run.");
      note("Fix: restart the game (systemctl restart hyper-hop) and read the log.");
    } else {
      note("There's no old profiles.json either, so there was nobody to move.");
      note("This is normal on a brand-new server: tap '+ New player' to start.");
    }
  } else {
    ok(accounts.length + " account(s):");
    for (const a of accounts) {
      note("- " + String(a.name).padEnd(10) +
        " role=" + String(a.role).padEnd(7) +
        " coins=" + String(a.coins).padEnd(5) +
        (a.passwordHash ? "has a password" : "NOT CLAIMED YET (taps to pick one)"));
    }
    const admins = accounts.filter(a => a.role === "admin");
    if (admins.length) ok("grown-up(s) in charge: " + admins.map(a => a.name).join(", "));
    else {
      bad("NOBODY is an admin — no one can change shared settings or level order.");
      note("Fix: edit " + path.join(DATA, "accounts.json") +
        " and set one person's \"role\" to \"admin\". No restart needed.");
    }
    // A password hash that isn't in our format would never match.
    const oddHash = accounts.filter(a => a.passwordHash != null &&
      !String(a.passwordHash).startsWith("scrypt$"));
    if (oddHash.length) {
      bad("these accounts have a password we can't read: " + oddHash.map(a => a.name).join(", "));
      note("Fix: set their \"passwordHash\" to null so they can pick a new one.");
    }
  }
}

/* ---------- 5. Ask the running server ---------- */
console.log("\nThe running server (http://localhost:" + PORT + ")");
(async () => {
  const base = "http://localhost:" + PORT;
  let reachable = false;
  try {
    const r = await fetch(base + "/api/me");
    reachable = true;
    const body = await r.text();
    if (r.status === 200) {
      ok("/api/me answered 200 " + (body === "null" ? "(nobody logged in — normal)" : body.slice(0, 60)));
    } else {
      bad("/api/me answered " + r.status + " — expected 200. Body: " + body.slice(0, 200));
      if (body.trim().startsWith("<")) {
        note("That's an HTML page, not JSON — you may be talking to the OLD server,");
        note("or something else is listening on this port.");
      }
    }
  } catch (e) {
    const why = (e.cause && e.cause.code) || e.code || e.message;
    bad("can't reach the game on port " + PORT + " (" + why + ").");
    note("Fix: systemctl status hyper-hop   and   journalctl -u hyper-hop -n 50");
    note("If you use a different port, run:  PORT=8080 node deploy/doctor.js");
  }

  if (reachable) {
    // A real end-to-end login, using an account nobody has claimed, so we
    // never need to know anybody's password and never change a thing.
    try {
      const list = await (await fetch(base + "/api/accounts")).json();
      if (Array.isArray(list)) ok("/api/accounts listed " + list.length + " player(s)");
      else bad("/api/accounts didn't answer with a list: " + JSON.stringify(list).slice(0, 120));

      // Does logging in actually hand back a cookie?
      const claimed = (list || []).find(a => a.hasPassword);
      if (!claimed) {
        note("nobody has picked a password yet, so there's no login to test.");
        note("That's expected right after deploying — the kids do it on first visit.");
      } else {
        const r = await fetch(base + "/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: claimed.name, password: "definitely-not-the-password" }),
        });
        const setCookie = r.headers.get("set-cookie");
        if (r.status === 401) {
          ok("a wrong password is refused properly (401)");
          if (setCookie) bad("...but it still handed out a cookie! That would be a bug.");
        } else if (r.status === 429) {
          ok("login is rate-limited right now (429) — somebody has been guessing.");
        } else {
          bad("a wrong password gave " + r.status + " instead of 401.");
        }
      }
    } catch (e) {
      bad("talking to the API failed: " + e.message);
    }
  }

  /* ---------- verdict ---------- */
  console.log("\n=== " + (problems
    ? problems + " thing(s) to look at above."
    : "Everything checks out. ✅") + " ===\n");
  if (!problems) {
    console.log("If the kids still can't log in, the trouble is probably in the");
    console.log("browser rather than the server. Worth checking:");
    console.log("  - are they on https://... (the Caddy address), not the bare IP:port?");
    console.log("  - hard-refresh the tablet (Safari: hold reload)");
    console.log("  - open the browser console and look for a red error\n");
  }
  process.exit(problems ? 1 : 0);
})();
