// ============================================================
// zoomguard.js — stops the page itself getting zoomed in and stuck.
// ============================================================
// This is NOT the editor's 🔍+ / 🔍− (that only makes the level's
// squares bigger). This is the BROWSER's own zoom — the one you get by
// pinching with two fingers. On an iPad it is far too easy to do by
// accident, and once it happens the buttons along the bottom of the
// level editor slide off the screen with no way back.
//
// So we do three things:
//   1. block the pinch (double-tap-to-zoom is handled by the styles);
//   2. keep an eye out in case it happens anyway (an iPad can zoom in
//      all by itself, and Safari has a zoom setting of its own);
//   3. show a "🔍 Reset zoom" button — placed wherever you can still
//      SEE, which is the whole trick — to put things back.
//
// Nothing here knows anything about the game; it just guards the page.

import { showToast } from "./toast.js";

// How zoomed-in counts as "zoomed in". Not exactly 1, because a tablet
// sometimes reports something like 1.0000001 when it is really fine.
const ZOOMED_AT = 1.02;
// How long we give the browser to un-zoom before we admit it didn't work.
const RESET_WAIT_MS = 400;
// How far from the corner of what you can see the button sits.
const BUTTON_MARGIN = 12;

// The bar the browser reads to decide how big the page is.
const viewportMeta = () => document.querySelector('meta[name="viewport"]');
// The part of the page you can actually see right now. Old browsers don't
// have this; then we simply never notice a zoom, and never show the button.
const vv = () => (typeof window !== "undefined" ? window.visualViewport : null);

// Is the page zoomed in, or shoved sideways so bits are off the screen?
function isZoomed() {
  const v = vv();
  if (!v) return false;
  return v.scale > ZOOMED_AT || v.offsetLeft > 1 || v.offsetTop > 1;
}

export function initZoomGuard() {
  const btn = document.getElementById("zoomResetBtn");

  // ---------- 1. block the pinch ----------
  // These three are Safari's own "two fingers are pinching" messages, and
  // saying no to them is what actually stops an iPad zooming. (The
  // "user-scalable=no" line in index.html looks like it should do this,
  // but iPads have ignored it for years.)
  for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(name, e => e.preventDefault(), { passive: false });
  }
  // Belt and braces for other browsers: two fingers sliding = a pinch.
  document.addEventListener("touchmove", e => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // Double-tap-to-zoom is dealt with in index.html instead, by the style rules
  // "touch-action: none" on the page and "touch-action: manipulation" on
  // everything you tap. We deliberately DON'T swallow quick double taps here:
  // saying no to a tap also throws away the button press that goes with it, so
  // tapping 🔍+ twice quickly would only count once.

  // ---------- 2. notice if it got zoomed anyway ----------
  const v = vv();
  if (!v || !btn) return;          // nothing to watch, or no button on the page

  function update() {
    if (!isZoomed()) { btn.classList.add("hidden"); return; }
    btn.classList.remove("hidden");
    // Put the button in the corner of the bit of page you can still SEE.
    // Without this it would sit in the corner of the whole page, which when
    // you're zoomed in is exactly the part that has scrolled out of view.
    btn.style.left = (v.offsetLeft + BUTTON_MARGIN) + "px";
    btn.style.top  = (v.offsetTop + BUTTON_MARGIN) + "px";
    // Zoomed in, everything on the page looks bigger — so shrink the button
    // by the same amount and it stays its normal, finger-sized self.
    btn.style.transform = "scale(" + (1 / Math.max(v.scale, 1)) + ")";
    btn.style.transformOrigin = "top left";
  }
  v.addEventListener("resize", update);
  v.addEventListener("scroll", update);
  update();

  // ---------- 3. the way back ----------
  btn.onclick = () => {
    window.scrollTo(0, 0);
    // The trick: the tag ALREADY says "never bigger than life-size", so setting
    // it to that again would change nothing and the browser wouldn't look twice.
    // We have to let go of the rule for one moment and then put it straight
    // back — that CHANGE is what makes the browser squash the page back down to
    // life-size. Most iPads take the hint. Some don't, so we check afterwards.
    const meta = viewportMeta();
    if (meta) {
      const locked = meta.getAttribute("content");
      meta.setAttribute("content", "width=device-width, initial-scale=1.0");
      requestAnimationFrame(() => meta.setAttribute("content", locked));
    }
    setTimeout(() => {
      update();
      if (isZoomed()) showToast("Pinch with two fingers to zoom back out");
    }, RESET_WAIT_MS);
  };
}
