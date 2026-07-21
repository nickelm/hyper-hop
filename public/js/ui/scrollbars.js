// ============================================================
// scrollbars.js — scroll bars you can drag with a finger.
// ============================================================
// A tablet has no mouse wheel, and the browser's own scroll bars are
// both invisible on touch screens and impossible to grab. So the
// editor draws its own: a dark track with a bright rounded thumb, in
// the same colors as the rest of the game.
//
// This module knows nothing about levels — you hand it a box that
// scrolls and the two bars, and it keeps them in step:
//
//   const bars = initScrollbars({ wrap, xBar, yBar });
//   bars.refresh();     // call whenever what's inside the box changes size
//
// Each bar element must hold exactly one child: the thumb.

const MIN_THUMB = 36;      // a thumb never gets smaller than this (or you can't grab it)

export function initScrollbars({ wrap, xBar, yBar }) {
  const bars = [makeBar(wrap, xBar, true), makeBar(wrap, yBar, false)];
  const refresh = () => bars.forEach(b => b.refresh());
  // The box can also be scrolled by a mouse wheel or by us, so keep up.
  wrap.addEventListener("scroll", refresh);
  return { refresh };
}

// One bar. `horizontal` picks which way it works; everything else is the same,
// so there is one piece of code for both bars instead of two nearly-equal ones.
function makeBar(wrap, bar, horizontal) {
  const thumb = bar.firstElementChild;

  // ---- the four numbers this bar is made of ----
  const total    = () => (horizontal ? wrap.scrollWidth  : wrap.scrollHeight);  // how big the grid is
  const visible  = () => (horizontal ? wrap.clientWidth  : wrap.clientHeight);  // how much you can see
  const scrolled = () => (horizontal ? wrap.scrollLeft   : wrap.scrollTop);     // where you're looking
  const scrollTo = (v) => {
    const max = Math.max(0, total() - visible());
    const at = Math.max(0, Math.min(max, v));
    if (horizontal) wrap.scrollLeft = at; else wrap.scrollTop = at;
  };
  const barLength = () => {
    const r = bar.getBoundingClientRect();
    return (horizontal ? r.width : r.height) || 0;
  };
  const along = (e) => {
    const r = bar.getBoundingClientRect();
    return horizontal ? e.clientX - r.left : e.clientY - r.top;
  };

  // Put the thumb where it belongs, and hide the whole bar when everything
  // already fits (nothing to scroll = nothing to grab).
  function refresh() {
    const seen = visible(), all = total();
    if (!(all > seen + 1)) { bar.style.visibility = "hidden"; return; }
    bar.style.visibility = "visible";
    const len = barLength();
    const thumbLen = Math.max(MIN_THUMB, len * (seen / all));
    const travel = Math.max(1, len - thumbLen);
    const at = travel * (scrolled() / Math.max(1, all - seen));
    if (horizontal) {
      thumb.style.width = thumbLen + "px"; thumb.style.height = "100%";
      thumb.style.left = at + "px"; thumb.style.top = "0px";
    } else {
      thumb.style.height = thumbLen + "px"; thumb.style.width = "100%";
      thumb.style.top = at + "px"; thumb.style.left = "0px";
    }
  }

  // ---- dragging the thumb ----
  let dragFrom = null, dragScroll = 0;
  thumb.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    dragFrom = along(e); dragScroll = scrolled();
    thumb.setPointerCapture(e.pointerId);
  });
  thumb.addEventListener("pointermove", (e) => {
    if (dragFrom === null) return;
    const len = barLength();
    const seen = visible(), all = total();
    const thumbLen = Math.max(MIN_THUMB, len * (seen / all));
    const travel = Math.max(1, len - thumbLen);
    // A finger moving one thumb-length along the bar moves the grid one
    // screenful — that's what makes the two feel joined together.
    scrollTo(dragScroll + (along(e) - dragFrom) * ((all - seen) / travel));
    refresh();
  });
  const stop = () => { dragFrom = null; };
  thumb.addEventListener("pointerup", stop);
  thumb.addEventListener("pointercancel", stop);

  // ---- tapping the track: jump one screenful that way ----
  bar.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const len = barLength();
    const seen = visible(), all = total();
    const thumbLen = Math.max(MIN_THUMB, len * (seen / all));
    const travel = Math.max(1, len - thumbLen);
    const thumbAt = travel * (scrolled() / Math.max(1, all - seen));
    scrollTo(scrolled() + (along(e) < thumbAt ? -seen : seen));
    refresh();
  });

  return { refresh };
}
