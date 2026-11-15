// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Plain browser APIs only. Also exposes one-shot key presses (buy, grenade,
// weapon slots, plant key) as a queue the game loop drains each frame.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = [];
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  function setKey(event, down) {
    if (down) {
      if (!event.repeat) pressed.push(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space' || event.code === 'Tab') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      try {
        // Newer browsers return a promise that rejects when lock is denied
        // (headless, iframe permissions); swallow it — the overlay stays up
        // and the game keeps running either way.
        const p = canvas.requestPointerLock();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // Pointer lock can fail if the tab lost focus; the overlay stays up.
      }
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    drainPressed() {
      if (pressed.length === 0) return pressed;
      const out = pressed.splice(0, pressed.length);
      return out;
    },
  };
}
