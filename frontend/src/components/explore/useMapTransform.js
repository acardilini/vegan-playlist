import { useCallback, useEffect, useRef, useState } from 'react';
// Explicit .js extensions: every module in this directory is plain ESM that `node --test`
// may load directly (no bundler), and Node's ESM resolver does not infer extensions.
import { FIT_VIEW, clampView, easeOutCubic, zoomAtPoint } from './mapGeometry.js';
import { deriveView, formatView } from './exploreUrlState.js';

// Below this a pointer-up is a click, not a pan — without it every attempt to drag the map
// would also select whichever song happened to be under the press.
const DRAG_THRESHOLD = 4;
// One press of + or −.
const ZOOM_STEP = 1.5;
// A wheel gesture has no end event, so the URL write is debounced instead of fired per notch.
const WHEEL_SETTLE_MS = 300;
// An eased move of the view (the guided walk following its next song).
const MOVE_MS = 380;

export function useMapTransform({ size, params, onCommit, hasMeasuredRef, reduceMotion }) {
  const urlView = params.get('view') || '';
  const [view, setView] = useState(() => deriveView(params));
  const [isDragging, setIsDragging] = useState(false);

  // What we last wrote to the URL. Compared against the URL on every render so an external
  // change (a pasted link, the Back button) resyncs while our own writes do not loop.
  const committedRef = useRef(urlView);
  const viewRef = useRef(view);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const wheelTimerRef = useRef(null);
  const sizeRef = useRef(size);
  // `onCommit` (ExploreMap's `commitView`) is re-created on every URL param write in the
  // page — song select, colour change, search text, not just a view commit — because it
  // closes over `setParam`, which closes over `params`. Reading it through a ref instead of
  // a useCallback dependency keeps `commit`, and everything built on it (`attachWheel`
  // included), referentially stable across those unrelated writes. Without this, a param
  // write inside the 300ms wheel-settle window tears down and rebuilds the wheel listener,
  // and the rebuild's cleanup cancels the pending debounced commit before it ever fires —
  // the zoom stays on screen but silently never reaches the URL.
  const onCommitRef = useRef(onCommit);
  const moveRafRef = useRef(0);
  const reduceRef = useRef(reduceMotion);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);
  useEffect(() => { reduceRef.current = reduceMotion; }, [reduceMotion]);
  useEffect(() => () => cancelAnimationFrame(moveRafRef.current), []);

  useEffect(() => {
    if (urlView === committedRef.current) return;
    committedRef.current = urlView;
    setView(deriveView(new URLSearchParams(`view=${urlView}`)));
  }, [urlView]);

  // A view saved on a wide screen can be out of bounds on a narrow one, so re-clamp whenever
  // the plot is resized. The identity check is load-bearing, not a micro-optimisation:
  // ResizeObserver hands back a fresh `size` object on every observation and clampView always
  // returns a fresh view, so returning it unconditionally would re-render on every
  // observation — a render loop with a redraw inside it.
  //
  // This effect also runs on mount, before ResizeObserver has measured anything, with `size`
  // still at ExploreMap's placeholder value. Clamping is a one-way ratchet — once tx/ty are
  // narrowed against a too-small size they stay narrowed, because when the real (wider) size
  // arrives the already-narrowed view sits comfortably inside the new, more permissive bounds
  // and the identity check above sees no change to make. A shared high-zoom link would be
  // silently truncated on load. So skip the clamp entirely until `hasMeasuredRef` says the
  // plot has been measured at least once; the first *real* size still clamps normally.
  useEffect(() => {
    if (hasMeasuredRef && !hasMeasuredRef.current) return;
    setView(v => {
      const next = clampView(v, size);
      return (next.k === v.k && next.tx === v.tx && next.ty === v.ty) ? v : next;
    });
    // hasMeasuredRef's identity is stable across renders (created once in ExploreMap via
    // useRef), so listing it changes no behaviour — it only silences the exhaustive-deps
    // warning for the ref access above.
  }, [size, hasMeasuredRef]);

  const commit = useCallback((next) => {
    const serialised = formatView(next);
    committedRef.current = serialised;
    onCommitRef.current(serialised);
  }, []);

  const cancelMove = useCallback(() => {
    cancelAnimationFrame(moveRafRef.current);
    moveRafRef.current = 0;
  }, []);

  // Eases the view to `target` (snaps under reduced motion). Any new gesture cancels it, and the
  // final view is committed to the URL once, like the end of a drag.
  const moveTo = useCallback((target) => {
    cancelMove();
    const next = clampView(target, sizeRef.current);
    if (reduceRef.current) {
      setView(next);
      commit(next);
      return;
    }
    const from = viewRef.current;
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / MOVE_MS);
      const e = easeOutCubic(t);
      setView({
        k: from.k + (next.k - from.k) * e,
        tx: from.tx + (next.tx - from.tx) * e,
        ty: from.ty + (next.ty - from.ty) * e,
      });
      if (t < 1) moveRafRef.current = requestAnimationFrame(frame);
      else { moveRafRef.current = 0; commit(next); }
    };
    moveRafRef.current = requestAnimationFrame(frame);
  }, [cancelMove, commit]);

  const zoomBy = useCallback((factor) => {
    cancelMove();
    const current = viewRef.current;
    const s = sizeRef.current;
    // Buttons zoom about the middle of the plot: there is no cursor to anchor to.
    const next = clampView(
      zoomAtPoint(current, current.k * factor, s.w / 2, s.h / 2), s);
    setView(next);
    commit(next);
  }, [cancelMove, commit]);

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);

  const reset = useCallback(() => {
    cancelMove();
    setView(FIT_VIEW);
    commit(FIT_VIEW);
  }, [cancelMove, commit]);

  // React attaches `wheel` at the root as a passive listener, so preventDefault() inside an
  // onWheel prop is ignored and the page scrolls instead of the map zooming. The listener has
  // to be registered directly, non-passive. Trackpad pinch arrives here as a ctrl-wheel and
  // works for free.
  const attachWheel = useCallback((el) => {
    if (!el) return undefined;
    const handler = (e) => {
      e.preventDefault();
      cancelMove();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.002);
      setView(v => clampView(
        zoomAtPoint(v, v.k * factor, px, py), sizeRef.current));
      clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = setTimeout(() => commit(viewRef.current), WHEEL_SETTLE_MS);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      clearTimeout(wheelTimerRef.current);
    };
  }, [cancelMove, commit]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cancelMove();
    dragRef.current = {
      x: e.clientX, y: e.clientY,
      tx: viewRef.current.tx, ty: viewRef.current.ty,
    };
    // Reset here rather than on pointer-up: `click` fires after `pointerup`, and the click
    // handler is what needs to know whether this gesture was a drag.
    movedRef.current = false;
  }, [cancelMove]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return false;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return true;
    if (!movedRef.current) setIsDragging(true);
    movedRef.current = true;
    setView(clampView({ k: viewRef.current.k, tx: d.tx + dx, ty: d.ty + dy }, sizeRef.current));
    return true;
  }, []);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Cleared unconditionally, not just inside the movedRef branch below: no path should be
    // able to leave `isDragging` stuck true once the pointer is up.
    setIsDragging(false);
    if (movedRef.current) {
      commit(viewRef.current);
    }
  }, [commit]);

  // The browser can end a gesture with `pointercancel` instead of `pointerup` — an OS
  // gesture taking over on touch, palm rejection, some Android edge-swipes. `pointerup` then
  // never arrives, so without this, dragRef/movedRef/isDragging would stay set: every later
  // pointermove would pan the map with no button held, the cursor would stay stuck on
  // "grabbing", and the next click would be swallowed by didDrag(). Unlike onPointerUp, this
  // never commits — the gesture was interrupted, not completed, so the partial pan is
  // discarded rather than written to the URL.
  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    movedRef.current = false;
    setIsDragging(false);
  }, []);

  const didDrag = useCallback(() => movedRef.current, []);

  return {
    view, isDragging,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel: cancelDrag, didDrag,
    zoomIn, zoomOut, reset, attachWheel, moveTo,
  };
}
