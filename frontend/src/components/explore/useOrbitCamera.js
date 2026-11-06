import { useCallback, useEffect, useRef, useState } from 'react';
// Explicit .js extensions: plain ESM that `node --test` may load directly.
import {
  DEFAULT_CAMERA, PRESETS, clampCamera, interpolateCamera,
} from './camera3d.js';
import { deriveCamera, formatCamera } from './exploreUrlState.js';
import { easeOutCubic } from './mapGeometry.js';

// The 3D counterpart of useMapTransform: same gesture vocabulary (4px click-vs-drag threshold,
// 1.5x zoom steps, a debounced URL write after a wheel burst), but it moves a camera instead of
// a 2D viewport. The maths lives in camera3d.js; this file is pointer/animation plumbing.
const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.5;
const WHEEL_SETTLE_MS = 300;
const PRESET_MS = 380;
const ORBIT_DEG_PER_PX = 0.4;
const KEY_STEP_DEG = 5;
const DRIFT_DEG_PER_S = 6;

export function useOrbitCamera({ size, params, onCommit, active, reduceMotion }) {
  const urlCam = params.get('cam') || '';
  const [camera, setCamera] = useState(() => deriveCamera(params));
  const [isDragging, setIsDragging] = useState(false);
  const [drift, setDrift] = useState(false);

  const cameraRef = useRef(camera);
  const committedRef = useRef(urlCam);
  const dragRef = useRef(null);
  const movedRef = useRef(false);
  const settleTimerRef = useRef(null);
  const moveRafRef = useRef(0);
  const sizeRef = useRef(size);
  const reduceRef = useRef(reduceMotion);
  // Read through a ref so `commit` (and the wheel listener built on it) stays referentially
  // stable when unrelated URL params change - see the same note in useMapTransform.
  const onCommitRef = useRef(onCommit);

  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { reduceRef.current = reduceMotion; }, [reduceMotion]);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);

  // The single place the camera changes: clamp, keep the ref in step with state.
  const apply = useCallback((next) => {
    const c = clampCamera(next);
    cameraRef.current = c;
    setCamera(c);
    return c;
  }, []);

  // A URL change from outside (pasted link, Back) resyncs; our own writes do not loop.
  useEffect(() => {
    if (urlCam === committedRef.current) return;
    committedRef.current = urlCam;
    apply(deriveCamera(new URLSearchParams(urlCam ? `cam=${urlCam}` : '')));
  }, [urlCam, apply]);

  const commit = useCallback((cam) => {
    const serialised = formatCamera(cam);
    committedRef.current = serialised;
    onCommitRef.current(serialised);
  }, []);

  const scheduleCommit = useCallback(() => {
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => commit(cameraRef.current), WHEEL_SETTLE_MS);
  }, [commit]);

  const cancelMove = useCallback(() => {
    cancelAnimationFrame(moveRafRef.current);
    moveRafRef.current = 0;
  }, []);

  // Eases to a target camera (snaps under reduced motion). A new gesture cancels it.
  const moveTo = useCallback((target) => {
    cancelMove();
    if (reduceRef.current) {
      commit(apply(target));
      return;
    }
    const from = cameraRef.current;
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / PRESET_MS);
      const c = apply(interpolateCamera(from, target, easeOutCubic(t)));
      if (t < 1) moveRafRef.current = requestAnimationFrame(frame);
      else { moveRafRef.current = 0; commit(c); }
    };
    moveRafRef.current = requestAnimationFrame(frame);
  }, [apply, cancelMove, commit]);

  const goToPreset = useCallback((name) => {
    if (!Object.hasOwn(PRESETS, name)) return;
    moveTo({ ...PRESETS[name], zoom: 1, panX: 0, panY: 0 });
  }, [moveTo]);

  const reset = useCallback(() => moveTo(DEFAULT_CAMERA), [moveTo]);

  // Zoom about a plot point: that point must stay under the cursor. On screen the offset from
  // the plot centre scales with zoom, so the pan is solved for the clamped ratio.
  const zoomAround = useCallback((px, py, factor) => {
    cancelMove();
    const cam = cameraRef.current;
    const s = sizeRef.current;
    const next = clampCamera({ ...cam, zoom: cam.zoom * factor });
    const ratio = next.zoom / cam.zoom;
    const dx = px - s.w / 2;
    const dy = py - s.h / 2;
    apply({
      ...next,
      panX: dx - (dx - cam.panX) * ratio,
      panY: dy - (dy - cam.panY) * ratio,
    });
  }, [apply, cancelMove]);

  const zoomBy = useCallback((factor) => {
    const s = sizeRef.current;
    zoomAround(s.w / 2, s.h / 2, factor);
    scheduleCommit();
  }, [zoomAround, scheduleCommit]);

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);

  // React attaches `wheel` as a passive root listener, so preventDefault() in an onWheel prop is
  // ignored and the page would scroll; register directly, non-passive.
  const attachWheel = useCallback((el) => {
    if (!el) return undefined;
    const handler = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAround(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.002));
      scheduleCommit();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      clearTimeout(settleTimerRef.current);
    };
  }, [zoomAround, scheduleCommit]);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0 && e.button !== 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cancelMove();
    dragRef.current = {
      x: e.clientX, y: e.clientY, cam: { ...cameraRef.current },
      mode: (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit',
    };
    // Reset here, not on pointer-up: `click` fires after `pointerup` and needs to know.
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
    if (d.mode === 'pan') {
      apply({ ...d.cam, panX: d.cam.panX + dx, panY: d.cam.panY + dy });
    } else {
      // Dragging right turns the near side of the cloud right; dragging down tips it down.
      apply({
        ...d.cam,
        yaw: d.cam.yaw - dx * ORBIT_DEG_PER_PX,
        pitch: d.cam.pitch + dy * ORBIT_DEG_PER_PX,
      });
    }
    return true;
  }, [apply]);

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    if (movedRef.current) commit(cameraRef.current);
  }, [commit]);

  // pointercancel (OS gesture takes over, palm rejection) never delivers pointerup. Without this
  // the drag state would stick and the next click would be swallowed. Unlike onPointerUp it does
  // NOT commit: the gesture was interrupted, not completed.
  const onPointerCancel = useCallback(() => {
    dragRef.current = null;
    movedRef.current = false;
    setIsDragging(false);
  }, []);

  const didDrag = useCallback(() => movedRef.current, []);

  const onContextMenu = useCallback((e) => e.preventDefault(), []);

  const onKeyDown = useCallback((e) => {
    const cam = cameraRef.current;
    let next = null;
    if (e.key === 'ArrowLeft') next = { ...cam, yaw: cam.yaw + KEY_STEP_DEG };
    else if (e.key === 'ArrowRight') next = { ...cam, yaw: cam.yaw - KEY_STEP_DEG };
    else if (e.key === 'ArrowUp') next = { ...cam, pitch: cam.pitch - KEY_STEP_DEG };
    else if (e.key === 'ArrowDown') next = { ...cam, pitch: cam.pitch + KEY_STEP_DEG };
    if (!next) return;
    e.preventDefault();
    cancelMove();
    apply(next);
    scheduleCommit();
  }, [apply, cancelMove, scheduleCommit]);

  // Drift: a slow turn about the vertical axis. Never under reduced motion, never while a
  // pointer is down or a preset move is running, and never written to the URL.
  useEffect(() => {
    if (!drift || !active || reduceMotion) return undefined;
    let raf = 0;
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);   // a hidden tab must not leap on return
      last = now;
      if (!dragRef.current && !moveRafRef.current && !document.hidden) {
        const cam = cameraRef.current;
        apply({ ...cam, yaw: cam.yaw + DRIFT_DEG_PER_S * dt });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [drift, active, reduceMotion, apply]);

  // Leaving 3D (or unmounting) stops every timer and animation the hook owns.
  useEffect(() => {
    if (active) return undefined;
    cancelMove();
    clearTimeout(settleTimerRef.current);
    dragRef.current = null;
    return undefined;
  }, [active, cancelMove]);
  useEffect(() => () => {
    cancelAnimationFrame(moveRafRef.current);
    clearTimeout(settleTimerRef.current);
  }, []);

  return {
    camera, isDragging, drift, setDrift,
    onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown, onContextMenu,
    didDrag, attachWheel, zoomIn, zoomOut, reset, goToPreset,
  };
}
