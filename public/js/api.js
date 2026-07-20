// ============================================================
// api.js — talking to the little server, in one place.
// ============================================================
// Every fetch the game makes goes through here. There's no PIN to
// type any more: when you log in, the server gives your browser a
// secret cookie and the browser sends it back automatically with
// every request. The game never sees that cookie (that's the point —
// nothing on this page can read it, so nothing can steal it).

// Where the API lives. We work this out from the page's own address so
// the game runs the same whether it's at the top of the site, in a
// subfolder, or on a custom port — no editing needed.
const API_BASE = new URL(".", document.baseURI).pathname + "api";

// "same-origin" means: send our login cookie along with the request.
// (Browsers do this by default, but we say it out loud so nobody
// wonders later how the server knows who's playing.)
const WITH_LOGIN = { credentials: "same-origin" };

// What to do when the server says "I don't know who you are" (401).
// main.js hands us a function that shows the login screen, so ANY
// request anywhere can bounce you back to it — in one place.
let onLoggedOut = () => {};
export function setLoggedOutHandler(fn) { onLoggedOut = fn; }

// Every answer comes back through here so errors look the same
// everywhere: the server's friendly message if it sent one.
async function readAnswer(res) {
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    onLoggedOut();
    throw new Error(data.error || "Please log in first — tap your name! 👋");
  }
  if (!res.ok) throw new Error(data.error || ("Server said " + res.status));
  return data;
}

// Ask the server for something and get back the answer as data.
export async function apiGet(path) {
  return readAnswer(await fetch(API_BASE + path, WITH_LOGIN));
}

// Send a change to the server (saving a level, a cube, the settings…).
export async function apiWrite(method, path, body) {
  return readAnswer(await fetch(API_BASE + path, {
    ...WITH_LOGIN,
    method,
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  }));
}

// The two everyday shapes, so call sites read nicely.
export function apiPost(path, body) { return apiWrite("POST", path, body); }
export function apiDelete(path) { return apiWrite("DELETE", path); }

// Show an "are you sure?" pop-up and wait for the answer. Resolves to true
// (Yes) or false (Cancel).
export function askConfirm(message) {
  return new Promise(resolve => {
    const box = document.getElementById("confirmBox");
    const yesBtn = document.getElementById("confirmYesBtn");
    const noBtn = document.getElementById("confirmNoBtn");
    document.getElementById("confirmMsg").textContent = message || "Are you sure?";
    box.classList.remove("hidden");
    function done(val) {
      box.classList.add("hidden");
      yesBtn.onclick = noBtn.onclick = null;
      resolve(val);
    }
    yesBtn.onclick = () => done(true);
    noBtn.onclick = () => done(false);
  });
}
