// ============================================================
// toast.js — the little pop-up message at the bottom.
// ============================================================
// "Saved!", "Copied!", "Deleted." — a short message that slides in
// and fades away on its own. Every screen uses it, so it lives here.

// Little pop-up message at the bottom of the screen.
export function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 1500);
}
