// ============================================================
// api.js — does the SERVER still play fair?
// ============================================================
// The golden traces watch the physics and boot.js watches the game
// holding together. This one watches the rules that involve other
// people and their coins: who may see a draft, what publishing costs,
// that a name belongs to one level, that a star toggles, that an
// adventure unlocks one level at a time, and — the big one — that two
// tablets racing for the last bounty slot can't both be paid.
//
// It starts a REAL server on a spare port with a brand-new, empty data
// folder of its own (HH_DATA_DIR), so it can make as much mess as it
// likes and your real levels are never touched.
//
//   node test/api.js      (or npm test, which runs all three)

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
/* The freeze test has to be a whole second run: READ_ONLY is read once
   when the server starts, so we can't change our minds half-way. The
   parent hands us its data folder (full of levels and players by then)
   and we check that everything really is frozen. */
const FROZEN = process.env.READ_ONLY === "true";
const TMP = process.env.HH_DATA_DIR ||
  path.join(os.tmpdir(), "hyper-hop-api-" + process.pid);
const PORT = 3100 + (process.pid % 400);
const BASE = "http://127.0.0.1:" + PORT;

process.env.HH_DATA_DIR = TMP;
process.env.PORT = String(PORT);

// ---------- saying what we expect ----------
let failures = 0;
function ok(what) { console.log("ok  " + what); }
function fail(what, detail) {
  failures++;
  console.log("NO  " + what + (detail ? "\n      " + detail : ""));
}
function is(what, got, wanted) {
  if (JSON.stringify(got) === JSON.stringify(wanted)) ok(what);
  else fail(what, "got " + JSON.stringify(got) + ", wanted " + JSON.stringify(wanted));
}
function yes(what, got) { got ? ok(what) : fail(what, "expected something true"); }

/* ---------- a pretend tablet ----------
   Each one keeps its own login cookie, so we can have two players
   logged in at the same time, just like two real tablets. */
function tablet(who) {
  let cookie = "";
  async function send(method, url, body) {
    const res = await fetch(BASE + url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of setCookie) {
      if (line.startsWith("hh_session=")) cookie = line.split(";")[0];
    }
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  return {
    who,
    get: url => send("GET", url),
    post: (url, body) => send("POST", url, body),
    put: (url, body) => send("PUT", url, body),
    del: url => send("DELETE", url),
  };
}

// A level grid that is legal, tiny, and has one coin and a finish.
const GRID = "..*..|";

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const server = require(path.join(ROOT, "server", "server.js"));
  await new Promise(r => setTimeout(r, 300));       // let it start listening

  // Shut the server down tidily. `closeAllConnections` matters: fetch
  // keeps its connections open for next time, and without this Node
  // would sit there waiting for them forever.
  function stopServer() {
    if (server.closeAllConnections) server.closeAllConnections();
    return new Promise(r => server.close(() => r()));
  }

  /* ================================================================
     ==============  THE FREEZE (a second run) ======================
     ================================================================
     READ_ONLY=true means "everybody can come in and play, but nothing
     may change". Reading and LOGGING IN still have to work — being
     frozen must never lock the kids out of their own game. */
  if (FROZEN) {
    const frozen = tablet("Ben");
    const login = await frozen.post("/api/login", { name: "Ben", password: "hoppy" });
    is("you can still log in while frozen", login.status, 200);
    yes("...and still read the levels", (await frozen.get("/api/levels")).data.length > 0);
    yes("...and still read the adventures", Array.isArray((await frozen.get("/api/adventures")).data));

    const purse = (await frozen.get("/api/me")).data.coins;
    const draft = (await frozen.get("/api/levels")).data.find(L => L.status === "draft");
    const listed = (await frozen.get("/api/levels")).data.find(L => L.status === "listed");
    const adventureId = (await frozen.get("/api/adventures")).data[0].id;

    is("making a level is frozen",
      (await frozen.post("/api/levels", { name: "Nope", author: "Ben", level: GRID })).status, 403);
    if (draft) {
      is("publishing is frozen",
        (await frozen.post("/api/levels/" + draft.id + "/publish")).status, 403);
    }
    is("starring is frozen", (await frozen.post("/api/stars/" + listed.id)).status, 403);
    is("putting up a prize is frozen",
      (await frozen.post("/api/levels/" + listed.id + "/bounty", { amountPer: 10 })).status, 403);
    is("hiding is frozen", (await frozen.post("/api/levels/" + listed.id + "/hide")).status, 403);
    is("changing an adventure is frozen",
      (await frozen.put("/api/adventures/" + adventureId, { name: "Nope" })).status, 403);
    is("...and making one", (await frozen.post("/api/adventures", { name: "Nope" })).status, 403);
    is("nobody's purse moved", (await frozen.get("/api/me")).data.coins, purse);

    if (failures) {
      console.log("\n" + failures + " thing(s) went wrong while frozen.");
      process.exitCode = 1;
    } else {
      console.log("\nFrozen means frozen. 🧊");
    }
    // Let Node finish by itself rather than calling process.exit: pulling
    // the rug out from under a socket that is still closing upsets it on
    // Windows (and the exit code we set above is what matters anyway).
    return stopServer();
  }

  try {
    /* ================================================================
       WHO'S PLAYING — three accounts, so we can be unkind to each other
       ================================================================ */
    const ana = tablet("Ana"), ben = tablet("Ben"), cass = tablet("Cass");
    for (const t of [ana, ben, cass]) {
      const r = await t.post("/api/accounts", { name: t.who, password: "hoppy" });
      if (r.status !== 200) throw new Error("could not make " + t.who + ": " + JSON.stringify(r.data));
    }
    ok("three players signed up");

    // Ana is promoted to curator by hand, the way a grown-up would —
    // and Ben is given a big purse, because he is about to publish a lot
    // of levels and we're not testing his budgeting here.
    const accountsFile = path.join(TMP, "accounts.json");
    const edit = change => {
      const all = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
      change(all);
      fs.writeFileSync(accountsFile, JSON.stringify(all, null, 2));
    };
    edit(all => {
      all.find(a => a.name === "Ana").role = "editor";
      all.find(a => a.name === "Ben").coins = 500;
    });
    // ...and it takes effect straight away, with no restart.
    is("a new job takes effect with no restart",
      (await ana.get("/api/me")).data.powers.includes("level.hide"), true);

    /* ================================================================
       DRAFTS — free, and nobody else's business
       ================================================================ */
    const startCoins = (await ben.get("/api/me")).data.coins;
    const made = await ben.post("/api/levels", { name: "Turbo Canyon", author: "Ben", level: GRID });
    is("a brand-new level is a draft", made.data.status, "draft");
    is("...and making it is free", (await ben.get("/api/me")).data.coins, startCoins);
    const levelId = made.data.id;

    yes("the owner sees their own draft",
      (await ben.get("/api/levels")).data.some(L => L.id === levelId));
    is("...and nobody else does",
      (await cass.get("/api/levels")).data.some(L => L.id === levelId), false);
    is("...not even logged out",
      (await tablet("nobody").get("/api/levels")).data.some(L => L.id === levelId), false);
    // A draft is PRIVATE, and a curator is not an exception: there is
    // nothing to moderate until somebody publishes it.
    is("...and not even a curator",
      (await ana.get("/api/levels")).data.some(L => L.id === levelId), false);

    /* ================================================================
       ONE NAME, ONE LEVEL
       ================================================================ */
    const clash = await cass.post("/api/levels", { name: "turbo canyon", author: "Cass", level: GRID });
    is("the same name in different capitals is refused", clash.status, 400);
    // Ben's level is a draft, so Cass is told the name is taken WITHOUT
    // being told what Ben is building.
    is("...and a private draft's name is not given away",
      /Turbo Canyon/.test(clash.data.error), false);
    yes("...but it still says what to do about it", /🎲/.test(clash.data.error));
    is("re-saving a level without renaming it is fine",
      (await ben.put("/api/levels/" + levelId,
        { name: "Turbo Canyon", author: "Ben", level: GRID })).status, 200);

    /* ================================================================
       HOW LONG MAY A LEVEL BE
       A kid building an epic ran into this wall, so the two ends of it
       are checked here: the longest allowed level saves, and one square
       longer is refused with words that say what to do about it.
       ================================================================ */
    const longest = ".".repeat(1999) + "|";
    is("a level 2000 squares long saves fine",
      (await cass.post("/api/levels", { name: "The Long Way", author: "Cass", level: longest })).status, 201);
    const tooLong = await cass.post("/api/levels",
      { name: "The Longer Way", author: "Cass", level: longest + "." });
    is("...and one square longer is refused", tooLong.status, 400);
    yes("...and it says how long a level may be", /2000/.test(tooLong.data.error));

    const words = await cass.get("/api/words");
    yes("the dice has words to pick from",
      words.data.adjectives.length > 20 && words.data.nouns.length > 20);

    /* ================================================================
       PUBLISHING — costs exactly once
       ================================================================ */
    const fee = (await ben.get("/api/prices")).data.publishFee;
    const before = (await ben.get("/api/me")).data.coins;
    const published = await ben.post("/api/levels/" + levelId + "/publish");
    is("publishing lists the level", published.data.level.status, "listed");
    is("...and costs the publish fee", published.data.balance, before - fee);
    is("publishing again is refused",
      (await ben.post("/api/levels/" + levelId + "/publish")).status, 403);
    is("...and doesn't charge twice", (await ben.get("/api/me")).data.coins, before - fee);
    yes("everybody can see it now",
      (await cass.get("/api/levels")).data.some(L => L.id === levelId));
    // ...and now that it IS public, the "name taken" message may say so.
    yes("a published level's name is named in the clash message",
      /Turbo Canyon/.test((await cass.post("/api/levels",
        { name: "TURBO canyon", author: "Cass", level: GRID })).data.error));

    is("somebody else can't publish your draft", await (async () => {
      const mine = await cass.post("/api/levels", { name: "Cass Cave", author: "Cass", level: GRID });
      return (await ben.post("/api/levels/" + mine.data.id + "/publish")).status;
    })(), 403);

    /* ---- a grown-up publishes for free ----
       The fee is there to make a KID stop and think before putting a
       level in front of everybody. Somebody looking after the game is
       doing a job, not showing off, so it costs them nothing. */
    const anaDraft = await ana.post("/api/levels", { name: "Curator Cavern", author: "Ana", level: GRID });
    const anaBefore = (await ana.get("/api/me")).data.coins;
    const anaPublished = await ana.post("/api/levels/" + anaDraft.data.id + "/publish");
    is("a curator's level publishes", anaPublished.data.level.status, "listed");
    is("...and it costs them nothing", anaPublished.data.spent, 0);
    is("...so their purse doesn't move", (await ana.get("/api/me")).data.coins, anaBefore);
    is("...and a kid still pays", (await ben.get("/api/prices")).data.publishFee, fee);

    // Too poor to publish: empty Cass's purse first.
    edit(all => { all.find(a => a.name === "Cass").coins = 2; });
    const poor = await cass.post("/api/levels", { name: "Sleepy Swamp", author: "Cass", level: GRID });
    const refused = await cass.post("/api/levels/" + poor.data.id + "/publish");
    is("you can't publish without the coins", refused.status, 403);
    yes("...and it says how many more you need", /\b13\b/.test(refused.data.error));
    is("...and the level is still safely a draft",
      (await cass.get("/api/levels")).data.find(L => L.id === poor.data.id).status, "draft");

    /* ================================================================
       REORDERING — from the list you can actually SEE
       ================================================================
       Nobody ever sees every level: drafts are missing, hidden ones are
       missing. So ▲▼ sends the ids it can see, and the server shuffles
       just those between the places they already sit in. */
    const admin = ana;                                  // give Ana the top job
    edit(all => { all.find(a => a.name === "Ana").role = "admin"; });
    const listedFor = async who =>
      (await who.get("/api/levels")).data.filter(L => L.status === "listed").map(L => L.id);

    const beforeOrder = await listedFor(admin);
    const swapped = [beforeOrder[1], beforeOrder[0], ...beforeOrder.slice(2)];
    const moved = await admin.put("/api/levels/order", { order: swapped });
    is("reordering a partial list works", moved.status, 200);
    is("...and really swaps those two", await listedFor(admin), swapped);
    // The draft never appeared in that list and must not have moved or vanished.
    yes("...leaving everybody's drafts exactly where they were",
      (await cass.get("/api/levels")).data.some(L => L.id === poor.data.id));
    await admin.put("/api/levels/order", { order: beforeOrder });   // put it back
    is("a made-up level id in the order is refused",
      (await admin.put("/api/levels/order", { order: [999999] })).status, 400);
    is("the same level twice is refused too",
      (await admin.put("/api/levels/order", { order: [beforeOrder[0], beforeOrder[0]] })).status, 400);
    is("a plain player still can't reorder anything",
      (await ben.put("/api/levels/order", { order: beforeOrder })).status, 403);

    /* ================================================================
       STARS — no coins, just "I like this one"
       ================================================================ */
    const star1 = await cass.post("/api/stars/" + levelId);
    is("a star counts", [star1.data.starred, star1.data.starCount], [true, 1]);
    const star2 = await ana.post("/api/stars/" + levelId);
    is("...and another one", star2.data.starCount, 2);
    const unstar = await cass.post("/api/stars/" + levelId);
    is("tapping again takes it back", [unstar.data.starred, unstar.data.starCount], [false, 1]);
    is("the level list carries the count",
      (await cass.get("/api/levels")).data.find(L => L.id === levelId).starCount, 1);
    is("...and whether YOU starred it",
      (await ana.get("/api/levels")).data.find(L => L.id === levelId).starredByMe, true);
    is("a star earns nobody any coins",
      (await ana.get("/api/me")).data.coinsEarnedTotal, 0);
    is("you can't star a level you can't even see",
      (await ben.post("/api/stars/" + poor.data.id)).status, 404);

    /* ================================================================
       ADVENTURES — one level at a time
       ================================================================ */
    // Three published levels for Ana to curate.
    const ids = [levelId];
    for (const name of ["Wobbly Maze", "Frozen Rush"]) {
      const L = await ben.post("/api/levels", { name, author: "Ben", level: GRID });
      await ben.post("/api/levels/" + L.data.id + "/publish");
      ids.push(L.data.id);
    }
    is("a player can't make an adventure",
      (await ben.post("/api/adventures", { name: "Nope", levelIds: ids })).status, 403);
    const adv = await ana.post("/api/adventures", { name: "First Journey", levelIds: ids });
    is("a curator can", adv.status, 201);
    const advId = adv.data.id;

    const seen = (await cass.get("/api/adventures")).data[0];
    is("you start at the very beginning", [seen.frontier, seen.score], [0, 0]);

    // Cass finishes level 2 out of order: the server must not count it.
    await cass.post("/api/runs", { levelId: ids[1], collectedCoinKeys: [], completed: true, adventureId: advId });
    is("you can't skip ahead", (await cass.get("/api/adventures")).data[0].frontier, 0);

    // Now in the right order.
    await cass.post("/api/runs", { levelId: ids[0], collectedCoinKeys: [], completed: true, adventureId: advId });
    is("beating the first one unlocks the second",
      (await cass.get("/api/adventures")).data[0].frontier, 1);
    await cass.post("/api/runs", { levelId: ids[1], collectedCoinKeys: [], completed: true, adventureId: advId });
    const two = (await cass.get("/api/adventures")).data[0];
    is("and the third", [two.frontier, two.score], [2, 2]);

    // A curator takes a beaten level out: the score drops, and comes back.
    await ana.put("/api/adventures/" + advId, { levelIds: [ids[1], ids[2]] });
    is("taking a level out lowers everyone's score",
      (await cass.get("/api/adventures")).data[0].score, 1);
    await ana.put("/api/adventures/" + advId, { levelIds: ids });
    is("...and putting it back brings it home",
      (await cass.get("/api/adventures")).data[0].score, 2);

    // A brand-new level dropped in at the front snaps everybody back to it.
    const inserted = await ben.post("/api/levels", { name: "Sneaky Alley", author: "Ben", level: GRID });
    await ben.post("/api/levels/" + inserted.data.id + "/publish");
    await ana.put("/api/adventures/" + advId, { levelIds: [inserted.data.id, ...ids] });
    is("a level put in the middle snaps the frontier back to it",
      (await cass.get("/api/adventures")).data[0].frontier, 0);
    await ana.put("/api/adventures/" + advId, { levelIds: ids });

    /* ---- a hidden level must not wall the adventure off ----
       Dee has beaten nothing, so the FIRST level is all she may play.
       Hide it and the second one has to become playable instead —
       otherwise one hidden level would stop the whole adventure dead. */
    const dee = tablet("Dee"), eli = tablet("Eli");
    for (const t of [dee, eli]) await t.post("/api/accounts", { name: t.who, password: "hoppy" });
    const shut = (await dee.get("/api/adventures")).data[0];
    is("a fresh player may only play the first level",
      [shut.playableIds, shut.frontier], [ids, 0]);
    await ana.post("/api/levels/" + ids[0] + "/hide");
    const open = (await dee.get("/api/adventures")).data[0];
    is("a hidden level is skipped, not a wall",
      [open.playableIds, open.frontier], [[ids[1], ids[2]], 0]);
    is("...and it vanishes from the level list for everybody else",
      (await cass.get("/api/levels")).data.some(L => L.id === ids[0]), false);
    yes("...but its owner still sees it",
      (await ben.get("/api/levels")).data.some(L => L.id === ids[0]));
    is("hiding it twice is refused",
      (await ana.post("/api/levels/" + ids[0] + "/hide")).status, 403);
    await ana.post("/api/levels/" + ids[0] + "/unhide");
    is("unhiding something that isn't hidden is refused too",
      (await ana.post("/api/levels/" + ids[0] + "/unhide")).status, 403);

    /* ---- a curator must not be able to publish for free ----
       Hiding a DRAFT and then unhiding it would put it on the list
       without the fee ever being paid. Both halves are refused. */
    const sneaky = await ana.post("/api/levels", { name: "Sneaky Loophole", author: "Ana", level: GRID });
    is("a draft can't be hidden (there's nothing to take it off)",
      (await ana.post("/api/levels/" + sneaky.data.id + "/hide")).status, 403);
    is("...so it can't be unhidden onto the list for free either",
      (await ana.post("/api/levels/" + sneaky.data.id + "/unhide")).status, 403);
    is("...and it is still a draft",
      (await ana.get("/api/levels")).data.find(L => L.id === sneaky.data.id).status, "draft");

    const board = await cass.get("/api/adventures/" + advId + "/board");
    is("the score board knows how far Cass got", board.data.board[0].score, 2);

    is("a draft can't go in an adventure",
      (await ana.put("/api/adventures/" + advId, { levelIds: [poor.data.id] })).status, 403);

    /* ---- an adventure's number is never used twice ----
       Everybody's progress is remembered against it. If a deleted
       adventure's number came back around, the new one would open up
       already half-finished for people who never played it. */
    const doomed = await ana.post("/api/adventures", { name: "Doomed Journey", levelIds: ids });
    await ana.del("/api/adventures/" + doomed.data.id);
    const replacement = await ana.post("/api/adventures", { name: "Hard Mode", levelIds: ids });
    is("a deleted adventure's number is never handed out again",
      replacement.data.id > doomed.data.id, true);
    is("...so the new one really does start from scratch",
      (await cass.get("/api/adventures")).data
        .find(a => a.id === replacement.data.id).score, 0);
    await ana.del("/api/adventures/" + replacement.data.id);

    /* ================================================================
       BOUNTIES — paid up front, won once each, never by the owner
       ================================================================ */
    const prices = (await ben.get("/api/prices")).data;
    const purseBefore = (await ben.get("/api/me")).data.coins;
    const put = await ben.post("/api/levels/" + levelId + "/bounty", { amountPer: 20 });
    is("a bounty is paid for up front",
      put.data.balance, purseBefore - 20 * prices.bountySlots);
    is("...and shows how many prizes are left",
      put.data.level.bounty.slotsLeft, prices.bountySlots);
    is("a second bounty while one is live is refused",
      (await ben.post("/api/levels/" + levelId + "/bounty", { amountPer: 10 })).status, 403);
    is("somebody else can't put a prize on your level",
      (await ana.post("/api/levels/" + levelId + "/bounty", { amountPer: 10 })).status, 403);
    is("a silly amount is refused",
      (await ben.post("/api/levels/" + levelId + "/bounty", { amountPer: 99999 })).status, 400);

    // The owner beating their own level wins nothing and uses no slot.
    const ownerBefore = (await ben.get("/api/me")).data.coins;
    const ownRun = await ben.post("/api/runs",
      { levelId, collectedCoinKeys: [], completed: true });
    is("you can never win your own prize", ownRun.data.bounty || 0, 0);
    is("...and it doesn't use up a slot",
      (await ben.get("/api/levels")).data.find(L => L.id === levelId).bounty.slotsLeft,
      prices.bountySlots);
    yes("...and costs the owner nothing", (await ben.get("/api/me")).data.coins >= ownerBefore);

    const win = await cass.post("/api/runs", { levelId, collectedCoinKeys: [], completed: true });
    is("beating it wins the prize", win.data.bounty, 20);
    const again = await cass.post("/api/runs", { levelId, collectedCoinKeys: [], completed: true });
    is("...but only once each", again.data.bounty || 0, 0);

    /* ---- two tablets racing for the last slot ----
       One prize left, two players tapping Finish at the very same
       moment. Exactly one of them must be paid, and the count must land
       on 0 — never on -1. */
    await ana.post("/api/runs", { levelId, collectedCoinKeys: [], completed: true });   // 2nd prize
    const raced = await Promise.all([
      dee.post("/api/runs", { levelId, collectedCoinKeys: [], completed: true }),
      eli.post("/api/runs", { levelId, collectedCoinKeys: [], completed: true }),
    ]);
    const paidOut = raced.map(r => r.data.bounty || 0).filter(n => n > 0);
    is("two tablets racing the last prize: exactly one is paid", paidOut, [20]);
    is("...and the prizes land on none left, never below",
      (await ben.get("/api/levels")).data.find(L => L.id === levelId).bounty.slotsLeft, 0);

    /* ---- the coins come home if the level goes away ---- */
    const refundLevel = await ben.post("/api/levels", { name: "Golden Tower", author: "Ben", level: GRID });
    await ben.post("/api/levels/" + refundLevel.data.id + "/publish");
    await ben.post("/api/levels/" + refundLevel.data.id + "/bounty", { amountPer: 5 });
    const beforeHide = (await ben.get("/api/me")).data.coins;
    await ana.post("/api/levels/" + refundLevel.data.id + "/hide");
    is("hiding a level gives the unwon prize money back",
      (await ben.get("/api/me")).data.coins, beforeHide + 5 * prices.bountySlots);

    const delLevel = await ben.post("/api/levels", { name: "Rusty Harbour", author: "Ben", level: GRID });
    await ben.post("/api/levels/" + delLevel.data.id + "/publish");
    await ben.post("/api/levels/" + delLevel.data.id + "/bounty", { amountPer: 5 });
    const beforeDelete = (await ben.get("/api/me")).data.coins;
    await ben.del("/api/levels/" + delLevel.data.id);
    is("deleting one does too",
      (await ben.get("/api/me")).data.coins, beforeDelete + 5 * prices.bountySlots);

    /* ================================================================
       PASSWORDS — a reset needs no restart
       ================================================================ */
    const reset = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
    reset.find(a => a.name === "Cass").passwordHash = null;
    fs.writeFileSync(accountsFile, JSON.stringify(reset, null, 2));
    const forgot = await tablet("x").post("/api/login", { name: "Cass", password: "hoppy" });
    is("a nulled password asks to be claimed again, with no restart",
      [forgot.status, forgot.data.needsPassword], [409, true]);
    const reclaimed = await tablet("x").post("/api/set-password", { name: "Cass", password: "newone" });
    is("...and picking a new one logs you straight in", reclaimed.data.name, "Cass");

    /* ================================================================
       AND THE COINS THEMSELVES ARE STILL THE COINS
       ================================================================ */
    const coinRun = await eli.post("/api/runs",
      { levelId: ids[2], collectedCoinKeys: ["2,0"], completed: true });
    is("a coin still pays", coinRun.data.credited, 1);
    is("...and only once",
      (await eli.post("/api/runs", { levelId: ids[2], collectedCoinKeys: ["2,0"], completed: true })).data.credited, 0);
    is("an unfinished run pays nothing",
      (await dee.post("/api/runs", { levelId: ids[2], collectedCoinKeys: ["2,0"], completed: false })).data.credited, 0);

    // Leave one of Ben's levels unpublished, so the frozen run below has
    // a draft of its own to try (and fail) to publish.
    await ben.post("/api/levels", { name: "Haunted Workshop", author: "Ben", level: GRID });
  } catch (e) {
    fail("the test itself fell over", e.stack);
  }

  await stopServer();

  if (failures) {
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log("\n" + failures + " thing(s) the server got wrong.");
    process.exit(1);
  }

  // Now do it all again with the freeze switch on, using the world we
  // just built. A fresh process, because READ_ONLY is only read once.
  console.log("\n--- again, with READ_ONLY=true ---");
  const { status } = require("child_process").spawnSync(
    process.execPath, [__filename],
    { env: { ...process.env, READ_ONLY: "true", HH_DATA_DIR: TMP }, stdio: "inherit" });

  fs.rmSync(TMP, { recursive: true, force: true });
  if (status !== 0) process.exit(status || 1);

  console.log("\nThe server plays fair. ✅");
  process.exit(0);
})();
