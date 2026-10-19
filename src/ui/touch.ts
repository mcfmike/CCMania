/**
 * Touch gestures for the battlefield and the map editor:
 * one-finger drag pans (with momentum) or paints, two fingers pinch-zoom and pan,
 * tap = click, long-press = secondary action.
 */

export interface Point {
  x: number;
  y: number;
}

export interface TouchHandlers {
  /** What a single finger does: move the camera, or draw (editor). */
  oneFinger: 'pan' | 'paint';
  /** Move the camera by a screen-space delta (finger movement). */
  pan(dx: number, dy: number): void;
  /** Zoom by a factor around a canvas-relative point. */
  zoom(factor: number, x: number, y: number): void;
  tap?(p: Point): void;
  longPress?(p: Point): void;
  paintStart?(p: Point): void;
  paintMove?(p: Point): void;
  paintEnd?(): void;
  /** A second finger landed mid-stroke: undo the stroke and switch to pan/zoom. */
  paintCancel?(): void;
}

const TAP_SLOP = 10;
const LONG_PRESS_MS = 500;

export function bindTouch(el: HTMLElement, h: TouchHandlers, signal: AbortSignal): void {
  let mode: 'none' | 'one' | 'two' | 'done' = 'none';
  let start = { x: 0, y: 0, t: 0 };
  let last = { x: 0, y: 0, t: 0 };
  let moved = false;
  let longFired = false;
  let longTimer = 0;
  let pinch = { dist: 1, x: 0, y: 0 };
  let vel = { x: 0, y: 0 };
  let inertia = 0;

  const rel = (t: Touch): Point => {
    const r = el.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };
  const pinchOf = (ts: TouchList) => {
    const a = rel(ts[0]);
    const b = rel(ts[1]);
    return { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const stopInertia = () => cancelAnimationFrame(inertia);
  const glide = () => {
    // Momentum: keep sliding after a flick, slowing down each frame.
    vel.x *= 0.92;
    vel.y *= 0.92;
    if (Math.hypot(vel.x, vel.y) < 0.02) return;
    h.pan(vel.x * 16, vel.y * 16);
    inertia = requestAnimationFrame(glide);
  };

  el.addEventListener(
    'touchstart',
    (e) => {
      e.preventDefault();
      stopInertia();
      if (e.touches.length === 1 && mode === 'none') {
        const p = rel(e.touches[0]);
        const now = performance.now();
        start = { ...p, t: now };
        last = { ...p, t: now };
        moved = false;
        longFired = false;
        vel = { x: 0, y: 0 };
        mode = 'one';
        if (h.oneFinger === 'paint') h.paintStart?.(p);
        else
          longTimer = window.setTimeout(() => {
            if (moved || mode !== 'one') return;
            longFired = true;
            try {
              navigator.vibrate?.(25);
            } catch {
              // Vibration is optional.
            }
            h.longPress?.(start);
          }, LONG_PRESS_MS);
      } else if (e.touches.length >= 2) {
        clearTimeout(longTimer);
        if (mode === 'one' && h.oneFinger === 'paint') h.paintCancel?.();
        mode = 'two';
        pinch = pinchOf(e.touches);
      }
    },
    { passive: false, signal },
  );

  el.addEventListener(
    'touchmove',
    (e) => {
      e.preventDefault();
      if (mode === 'one' && e.touches.length === 1) {
        const p = rel(e.touches[0]);
        const now = performance.now();
        if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > TAP_SLOP) {
          moved = true;
          clearTimeout(longTimer);
        }
        if (h.oneFinger === 'paint') h.paintMove?.(p);
        else if (moved) {
          const dx = p.x - last.x;
          const dy = p.y - last.y;
          const dt = Math.max(1, now - last.t);
          h.pan(dx, dy);
          vel = { x: vel.x * 0.6 + (dx / dt) * 0.4, y: vel.y * 0.6 + (dy / dt) * 0.4 };
        }
        last = { ...p, t: now };
      } else if (mode === 'two' && e.touches.length >= 2) {
        const p = pinchOf(e.touches);
        h.zoom(p.dist / pinch.dist, p.x, p.y);
        h.pan(p.x - pinch.x, p.y - pinch.y);
        pinch = p;
      }
    },
    { passive: false, signal },
  );

  const end = (e: TouchEvent) => {
    e.preventDefault();
    if (mode === 'one' && e.touches.length === 0) {
      clearTimeout(longTimer);
      if (h.oneFinger === 'paint') h.paintEnd?.();
      else if (!moved && !longFired && performance.now() - start.t < LONG_PRESS_MS) h.tap?.(start);
      else if (moved && performance.now() - last.t < 80) inertia = requestAnimationFrame(glide);
    }
    if (mode === 'two' && e.touches.length < 2) mode = 'done';
    if (e.touches.length === 0) mode = 'none';
  };
  el.addEventListener('touchend', end, { passive: false, signal });
  el.addEventListener('touchcancel', end, { passive: false, signal });
}
