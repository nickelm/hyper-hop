// ============================================================
// input.js — tapping and key presses.
// ============================================================
// Turns taps, clicks, and key presses into game actions: jump,
// hold-to-keep-jumping, Escape to go back, Z/X for practice
// checkpoints, and the little on-screen buttons.
//
// It doesn't know how the game works — main.js hands it the handful
// of things to call (jump, leaveGame, ...) when initInput() runs.

export function initInput(deps) {
  const { S, getPlayer, jump, afterWin, leaveGame,
          dropCheckpoint, removeCheckpoint, openPanel, closePanel, isPanelOpen } = deps;

  // Is a finger (or the space bar) being held down right now?
  let holding = false;

  function pressDown(e) {
    if (e.target.closest("button") || e.target.closest("#editorScreen") || e.target.closest("#skinScreen") ||
        e.target.closest("#exportBox") ||
        e.target.closest("#importBox") || e.target.closest("#saveBox") || e.target.closest("#pinBox") ||
        e.target.closest("#confirmBox") || e.target.closest("#controlPanel")) return;
    holding = true;
    if (S.screen === "game") {
      const player = getPlayer();
      if (player && player.won) { afterWin(); return; }
      jump();
    }
  }
  function pressUp() { holding = false; }
  window.addEventListener("pointerdown", pressDown);
  window.addEventListener("pointerup", pressUp);
  window.addEventListener("keydown", e => {
    if (e.code === "Space" || e.code === "ArrowUp") {
      const player = getPlayer();
      if (player && player.won) { afterWin(); return; }
      if (!holding) jump();
      holding = true;
    }
  });
  window.addEventListener("keyup", () => holding = false);
  // hold-to-keep-jumping, like the real game
  setInterval(() => {
    const player = getPlayer();
    if (holding && S.screen === "game" && !S.paused && player && player.onGround) jump();
  }, 40);

  // Extra keys: Escape = back (or close the panel), Z = drop checkpoint, X = remove.
  window.addEventListener("keydown", e => {
    if (e.code === "Escape") {
      if (isPanelOpen()) closePanel();
      else if (S.screen === "game") leaveGame();
    } else if (S.screen === "game" && S.practice && !S.paused) {
      if (e.code === "KeyZ") dropCheckpoint();
      else if (e.code === "KeyX") removeCheckpoint();
    }
  });

  // In-game buttons
  document.getElementById("backBtn").onclick = leaveGame;
  document.getElementById("gearBtn").onclick = openPanel;
  document.getElementById("menuGearBtn").onclick = openPanel;
  document.getElementById("dropCpBtn").onclick = dropCheckpoint;
  document.getElementById("removeCpBtn").onclick = removeCheckpoint;
}
