/**
 * Touch gestures of the mobile layout: horizontal swipes on the stage (the PixiJS canvas) and the bottom sheet's
 * drag handle. Only the canvas starts swipes, so they never compete with timeline scrubbing, the ranking or a
 * scrolling sheet (those are DOM elements above the canvas and receive their own touches).
 */
import { detectSwipe, type Pt } from '../input/swipe';
import { TAP_SLOP, sheetShouldClose } from './mobileLayout';

export interface SwipeOptions {
  /** the element swipes start on (the stage canvas) */
  surface: HTMLElement;
  /** gestures are tracked only while this holds (the mobile layout) */
  enabled(): boolean;
  /** swipes step the front only while this holds (a front is shown, not the galaxy map) */
  steppable(): boolean;
  /** 'left' = the finger moved left (next front), 'right' = previous */
  onSwipe(dir: 'left' | 'right'): void;
  /**
   * Called with true once the pointer has moved further than a tap may (and with false when the gesture ends):
   * the renderer must not turn the release into a tap that selects a unit or enters a planet.
   */
  suppressTaps?(on: boolean): void;
  /** ms clock (default `performance.now`) */
  now?(): number;
}

/** Starts tracking; returns a function that stops it. */
export function trackSwipes(o: SwipeOptions): () => void {
  const win = o.surface.ownerDocument.defaultView ?? window;
  const now = o.now ?? (() => performance.now());
  let g: (Pt & { id: number; moved: boolean }) | null = null;

  const release = () => {
    if (g?.moved) o.suppressTaps?.(false);
    g = null;
  };
  const down = (e: PointerEvent) => {
    if (g) {
      // a second finger: a pinch, not a swipe
      release();
      return;
    }
    if (!o.enabled() || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), moved: false };
  };
  const move = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id || g.moved) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP_SLOP) {
      g.moved = true;
      o.suppressTaps?.(true);
    }
  };
  const up = (e: PointerEvent) => {
    if (!g || e.pointerId !== g.id) return;
    const dir = detectSwipe(g, { x: e.clientX, y: e.clientY, t: now() });
    release();
    if (dir && o.enabled() && o.steppable()) o.onSwipe(dir);
  };
  const cancel = (e: PointerEvent) => {
    if (g && e.pointerId === g.id) release();
  };

  o.surface.addEventListener('pointerdown', down);
  // capture on window: registered after PixiJS's own window listener, so the renderer has already seen (and, while
  // taps are suppressed, ignored) this release by the time it is handled here
  win.addEventListener('pointermove', move, true);
  win.addEventListener('pointerup', up, true);
  win.addEventListener('pointercancel', cancel, true);
  return () => {
    release();
    o.surface.removeEventListener('pointerdown', down);
    win.removeEventListener('pointermove', move, true);
    win.removeEventListener('pointerup', up, true);
    win.removeEventListener('pointercancel', cancel, true);
  };
}

export interface SheetDragOptions {
  /** the grab handle (a button: a tap closes the sheet too) */
  handle: HTMLElement;
  /** the sheet that follows the finger */
  sheet: HTMLElement;
  enabled(): boolean;
  onClose(): void;
  now?(): number;
}

/**
 * Drag the sheet down by its handle: it follows the finger (resisting upward pulls), closes when released far or fast
 * enough (`sheetShouldClose`) and springs back otherwise. A tap on the handle closes it (it is a close button).
 */
export function dragSheet(o: SheetDragOptions): () => void {
  const now = o.now ?? (() => performance.now());
  let d: { id: number; y0: number; dy: number; py: number; pt: number; vy: number; moved: boolean } | null = null;

  const place = (px: number | null) => {
    if (px === null) {
      o.sheet.style.removeProperty('transform');
      o.sheet.classList.remove('sheet-dragging');
    } else {
      o.sheet.classList.add('sheet-dragging');
      o.sheet.style.setProperty('transform', `translateY(${px.toFixed(1)}px)`);
    }
  };
  const down = (e: PointerEvent) => {
    if (!o.enabled() || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    d = { id: e.pointerId, y0: e.clientY, dy: 0, py: e.clientY, pt: now(), vy: 0, moved: false };
    try {
      o.handle.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best effort */
    }
  };
  const move = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.id) return;
    const t = now();
    d.dy = e.clientY - d.y0;
    if (t > d.pt) d.vy = (e.clientY - d.py) / (t - d.pt);
    d.py = e.clientY;
    d.pt = t;
    if (Math.abs(d.dy) > TAP_SLOP) d.moved = true;
    if (d.moved) place(d.dy > 0 ? d.dy : Math.max(-24, d.dy / 4));
  };
  const up = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.id) return;
    const { dy, vy, moved } = d;
    d = null;
    place(null);
    if (moved && !sheetShouldClose(dy, vy, o.sheet.offsetHeight)) return; // spring back (CSS transition)
    o.onClose();
  };
  const cancel = (e: PointerEvent) => {
    if (!d || e.pointerId !== d.id) return;
    d = null;
    place(null);
  };
  // a keyboard / screen-reader activation of the handle button
  const click = (e: MouseEvent) => {
    if (e.detail === 0 && o.enabled()) o.onClose();
  };

  o.handle.addEventListener('pointerdown', down);
  o.handle.addEventListener('pointermove', move);
  o.handle.addEventListener('pointerup', up);
  o.handle.addEventListener('pointercancel', cancel);
  o.handle.addEventListener('click', click);
  return () => {
    o.handle.removeEventListener('pointerdown', down);
    o.handle.removeEventListener('pointermove', move);
    o.handle.removeEventListener('pointerup', up);
    o.handle.removeEventListener('pointercancel', cancel);
    o.handle.removeEventListener('click', click);
    place(null);
  };
}
