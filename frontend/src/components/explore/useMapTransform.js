import { useCallback, useEffect, useRef, useState } from 'react';
import { FIT_VIEW, clampView, zoomAtPoint } from './mapGeometry';
import { deriveView, formatView } from './exploreUrlState';

// Below this a pointer-up is a click, not a pan — without it every attempt to drag the map
// would also select whichever song happened to be under the press.
const DRAG_THRESHOLD = 4;
// One press of + or −.
const ZOOM_STEP = 1.5;
// A wheel gesture has no end event, so the URL write is debounced instead of fired per notch.
const WHEEL_SETTLE_MS = 300;

export function useMapTransform({ size, params, onCommit }) {
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

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { sizeRef.current = size; }, [size]);

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
  useEffect(() => {
    setView(v => {
      const next = clampView(v, size);
      return (next.k === v.k && next.tx === v.tx && next.ty === v.ty) ? v : next;
    });
  }, [size]);

  const commit = useCallback((next) => {
    const serialised = formatView(next);
    committedRef.current = serialised;
    onCommit(serialised);
  }, [onCommit]);

  const zoomBy = useCallback((factor) => {
    const current = viewRef.current;
    const s = sizeRef.current;
    // Buttons zoom about the middle of the plot: there is no cursor to anchor to.
    const next = clampView(
      zoomAtPoint(current, current.k * factor, s.w / 2, s.h / 2), s);
    setView(next);
    commit(next);
  }, [commit]);

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);

  const reset = useCallback(() => {
    setView(FIT_VIEW);
    commit(FIT_VIEW);
  }, [commit]);

  // React attaches `wheel` at the root as a passive listener, so preventDefault() inside an
  // onWheel prop is ignored and the page scrolls instead of the map zooming. The listener has
  // to be registered directly, non-passive. Trackpad pinch arrives here as a ctrl-wheel and
  // works for free.
  const attachWheel = useCallback((el) => {
    if (!el) return undefined;
    const handler = (e) => {
      e.preventDefault();
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
  }, [commit]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX, y: e.clientY,
      tx: viewRef.current.tx, ty: viewRef.current.ty,
    };
    // Reset here rather than on pointer-up: `click` fires after `pointerup`, and the click
    // handler is what needs to know whether this gesture was a drag.
    movedRef.current = false;
  }, []);

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
    if (movedRef.current) {
      setIsDragging(false);
      commit(viewRef.current);
    }
  }, [commit]);

  const didDrag = useCallback(() => movedRef.current, []);

  return {
    view, isDragging,
    onPointerDown, onPointerMove, onPointerUp, didDrag,
    zoomIn, zoomOut, reset, attachWheel,
  };
}
