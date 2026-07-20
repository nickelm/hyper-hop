// ============================================================
// api.js — talking to the little server, in one place.
// ============================================================
// Every fetch the game makes goes through here, plus the family-PIN
// handling and the two little pop-ups (PIN and "are you sure?"). The
// game reads with apiGet, changes things with apiWrite (which asks for
// the PIN), and saves a score with apiPost (no PIN — playing is open).

// Where the API lives. We work this out from the page's own address so
// the game runs the same whether it's at the top of the site, in a
// subfolder, or on a custom port — no editing needed.
const API_BASE = new URL(".", document.baseURI).pathname + "api";

// Ask the server for something and get back the answer as data.
export async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error("Server said " + res.status);
  return res.json();
}

// The family PIN, remembered ONLY for this visit (never saved to the device,
// on purpose — see CLAUDE.md). We ask for it the first time you save.
let familyPin = null;

// Show the PIN pop-up and wait for the kid to type it. Resolves to the PIN,
// or null if they tapped Cancel.
function askPin(message) {
  return new Promise(resolve => {
    const box = document.getElementById("pinBox");
    const input = document.getElementById("pinInput");
    const okBtn = document.getElementById("pinOkBtn");
    const cancelBtn = document.getElementById("pinCancelBtn");
    document.getElementById("pinMsg").textContent = message || "Type the family PIN to save:";
    input.value = "";
    box.classList.remove("hidden");
    setTimeout(() => input.focus(), 50);
    function done(val) {
      box.classList.add("hidden");
      okBtn.onclick = cancelBtn.onclick = input.onkeydown = null;
      resolve(val);
    }
    okBtn.onclick = () => done(input.value.trim() || null);
    cancelBtn.onclick = () => done(null);
    input.onkeydown = e => { if (e.key === "Enter") done(input.value.trim() || null); };
  });
}

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

// Send a change to the server with the family PIN attached. If the PIN is
// wrong the server says 401, so we forget it and ask again once.
export async function apiWrite(method, path, body) {
  async function send() {
    const res = await fetch(API_BASE + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Family-Pin": familyPin },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }
  if (!familyPin) { familyPin = await askPin(); if (!familyPin) throw new Error("cancelled"); }
  let { res, data } = await send();
  if (res.status === 401) {
    familyPin = await askPin("That PIN was wrong. Try again:");
    if (!familyPin) throw new Error("cancelled");
    ({ res, data } = await send());
  }
  if (!res.ok) throw new Error(data.error || ("Server said " + res.status));
  return data;
}

// Save a score: a plain POST with NO family PIN (playing should never ask for
// the PIN). Throws if the server refuses, so the caller can just shrug it off.
export async function apiPost(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Server said " + res.status);
  return res.json();
}
