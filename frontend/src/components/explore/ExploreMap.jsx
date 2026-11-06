import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useExplorePoints } from './useExplorePoints';
import { colourScale, dimColour } from './palette';
import SelectedSongCard from './SelectedSongCard';
import {
  easeOutCubic, extentsFor, layout, outsideCore, projectPoint, viewCentredOn,
} from './mapGeometry';
import { useMapTransform } from './useMapTransform';
import { useOrbitCamera } from './useOrbitCamera';
import MapToolbar from './MapToolbar';
import { placeLabels, truncateLabel } from './mapLabels';
import { nearestSongs } from './neighbours';
import { walkBack, walkBase, walkNext, walkPrune } from './walk';
import YearStrip from './YearStrip';
import {
  activePreset as presetOf, dotAlpha, dotRadius, gizmoAxes, panCentredOn, pickPoint, projectCloud,
  sortBackToFront,
} from './camera3d';
import {
  deriveColour, deriveDim, deriveFlag, deriveQuery, deriveSelectedId, deriveSpace, deriveSpotlit,
  deriveYear, formatYear, songPassesSpotlight, withParam, withParams, yearBounds, yearState,
} from './exploreUrlState';

const DOT_RADIUS = 4;

// A group toggles all of its members at once; a leaf toggles itself. Spotlight state holds
// raw codes only, because that is what a song carries — the group is a legend construct.
// Module-level (not a component closure) because it is pure and shared by rendering and the
// click handler alike.
function codesOf(entry) {
  return entry.children && entry.children.length
    ? entry.children.map(c => c.code)
    : [entry.code];
}

// Finds a legend entry by code across BOTH the top-level array and every group's `children`.
// Most genres live only inside a group's `children` (see backend/services/explore.js's
// "Other genres" grouping), so a plain top-level `.find` misses them and renders a blank
// label for any song in the tail — the dot is still correctly coloured/spotlightable, only
// the text lookup was too narrow. This is the single lookup every label-resolving call site
// must use instead of duplicating the two-level search.
function findLegendEntry(legend, code) {
  if (!legend) return null;
  for (const entry of legend.codes) {
    if (entry.code === code) return entry;
    const child = (entry.children || []).find(c => c.code === code);
    if (child) return child;
  }
  return null;
}

// Tri-state for a legend toggle button: none of its codes are spotlit, all of them are, or
// (group only) some but not all — the last case needs its own visual language, since it is
// neither "fully selected" nor "irrelevant to the current spotlight".
function legendToggleState(entry, spotlit) {
  const codes = codesOf(entry);
  const litCount = codes.filter(code => spotlit.has(code)).length;
  const allOn = litCount === codes.length;
  const someOn = litCount > 0 && !allOn;
  return { allOn, someOn };
}

function legendAriaPressed({ allOn, someOn }) {
  return someOn ? 'mixed' : allOn;
}

// A group with lit children must not look identical to a fully-dimmed group — that is the
// distinction the "mixed" case exists to preserve — so `someOn` gets its own class rather
// than falling into the plain `off` dimming.
function legendToggleClass({ allOn, someOn }, spotlit) {
  if (someOn) return 'explore-legend-toggle explore-legend-toggle--partial';
  const dimmed = spotlit.size > 0 && !allOn;
  return `explore-legend-toggle ${dimmed ? 'off' : ''}`;
}

// A full-canvas animation is exactly the case the media query exists for, so the tween is
// not merely shortened under it — it is skipped, and the new space snaps into place.
function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduce;
}

// Long enough to read a song travelling between two spaces, short enough not to be a wait.
const TWEEN_MS = 450;
const HOVER_GROWTH = 3;   // px added to the hovered dot's radius

// Length (px) of the orientation gizmo's axes, and its inset from the plot's bottom-right corner.
const GIZMO_LEN = 22;
const GIZMO_INSET = 44;

function ExploreMap() {
  const { data, loading, error, reload } = useExplorePoints();
  // State, not a plain ref: while `data` is loading this component returns early and the
  // canvas never mounts, so a ref alone would sit at null through that render with nothing
  // to notice when it later attaches. Tracking the element in state makes its arrival a
  // dependency the wheel-attach effect below can react to.
  const [canvasEl, setCanvasEl] = useState(null);
  // State, not a plain ref, for the same reason as `canvasEl` above: while `data` is loading
  // this component returns the loading `<div>` instead of the real markup, so `.explore-plot`
  // does not exist on that first commit. A ref would sit at null through that render with
  // nothing to notice when the element later attaches, and with an empty dependency array the
  // observer effect below would never run again — tracking the element in state makes its
  // arrival a dependency the effect can react to.
  const [plotEl, setPlotEl] = useState(null);
  const positionsRef = useRef([]);
  const lastFrameRef = useRef(null);   // Map<id, {x, y}> — the most recent frame actually drawn
  const tweenRef = useRef(null);       // { from: Map<id,{x,y}>, start: number }
  const reduceMotion = usePrefersReducedMotion();
  const [size, setSize] = useState({ w: 800, h: 520 });
  // Flips true the first time ResizeObserver reports a real measurement. useMapTransform's
  // resize-clamp effect reads this to skip clamping on mount, while `size` itself keeps this
  // placeholder value — everything else that reads `size` (the draw effect, hover-card
  // clamping, zoomBy's centre point) is fine drawing against a plausible guess for one frame;
  // only the clamp is a one-way ratchet that must not run against an unmeasured size.
  const hasMeasuredRef = useRef(false);
  const [hover, setHover] = useState(null);   // { song, x, y }

  const [params, setParams] = useSearchParams();

  // Every rule about what the URL may say lives in exploreUrlState.js — see the comment
  // there for why this is not inlined.
  const space = data ? deriveSpace(params, data.spaces) : null;
  const colour = data ? deriveColour(params, data.colourBy) : null;
  const query = deriveQuery(params);
  const selectedId = deriveSelectedId(params);
  const spotlit = useMemo(() => deriveSpotlit(params), [params]);
  // 3D only where the current space has 3D positions; a stale `dim=3d` link degrades to 2D.
  const has3d = !!(data && data.spaces.some(s => s.key === space && s.has3d));
  const dim = deriveDim(params, has3d);
  // Both on by default; only an explicit `=0` turns them off.
  const showLabels = deriveFlag(params, 'labels');
  const showLines = deriveFlag(params, 'lines');

  const setParam = useCallback((key, value) => {
    setParams(withParam(params, key, value), { replace: true });
  }, [params, setParams]);

  // The viewport is committed to the URL at the end of a gesture, never per pixel — a pan
  // writing 60 history entries would make Back useless.
  const commitView = useCallback((serialised) => setParam('view', serialised), [setParam]);
  const transform = useMapTransform({
    size, params, onCommit: commitView, hasMeasuredRef, reduceMotion,
  });
  const commitCam = useCallback((serialised) => setParam('cam', serialised), [setParam]);
  const orbit = useOrbitCamera({
    size, params, onCommit: commitCam, active: dim === '3d', reduceMotion, hasMeasuredRef,
  });
  // Whichever hook owns the pointer right now; both are always called (hooks cannot be
  // conditional) but only one is wired to the canvas.
  const gesture = dim === '3d' ? orbit : transform;

  // Track the plot box so the canvas can be backing-store accurate. Depends on `plotEl`, not
  // just an empty array: on first load the plot wrapper is unmounted (the loading-state early
  // return below fires instead), so an effect that only ran once on mount would observe
  // nothing and `size` would be stuck at the placeholder for the life of the page.
  useEffect(() => {
    if (!plotEl) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      hasMeasuredRef.current = true;
      setSize({ w: Math.max(240, r.width), h: Math.max(280, r.height) });
    });
    ro.observe(plotEl);
    return () => ro.disconnect();
  }, [plotEl]);

  const legend = useMemo(
    () => (data && data.colourBy.find(c => c.key === colour)) || null,
    [data, colour]);

  const spaceMeta = useMemo(
    () => (data && data.spaces.find(s => s.key === space)) || null,
    [data, space]);

  const scale = useMemo(
    () => colourScale(legend ? legend.codes : [], legend && legend.label),
    [legend]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return null;   // null = "no query", distinct from "no matches"
    return data.songs.filter(s =>
      s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q));
  }, [data, query]);

  // An empty (but non-null) match list must dim nothing — only a non-empty list narrows the
  // plot. "No songs match" is driven by `matches` itself (see the rail below), not by this.
  const matchIds = useMemo(
    () => (matches && matches.length > 0 ? new Set(matches.map(s => s.id)) : null), [matches]);

  const selected = useMemo(
    () => (data && selectedId ? data.songs.find(s => s.id === selectedId) || null : null),
    [data, selectedId]);

  // Release-year cutoff: null = all years. Bounds come from the songs themselves.
  const bounds = useMemo(() => (data ? yearBounds(data.songs) : null), [data]);
  const year = deriveYear(params, bounds);

  // The 8 songs nearest the selected one in the map's own coordinates. Recomputed only when the
  // selection, space or view dimension changes - never per camera frame.
  const neighbourIds = useMemo(() => {
    if (!data || !selectedId || !space || !showLines) return null;
    return new Set(nearestSongs(data.songs, selectedId, space, dim, 8).map(n => n.id));
  }, [data, selectedId, space, dim, showLines]);

  // The guided walk: the path visited so far lives in component state, not the URL. It only means
  // anything while its last element is the selected song (see walk.js), so clearing or changing
  // the selection restarts the walk with no extra code.
  const [walkPath, setWalkPath] = useState([]);
  const walkLength = walkBase(walkPath, selectedId).length;
  // Escape, the card's x or picking any other song forgets the walk.
  useEffect(() => {
    setWalkPath(p => (p.length === 0 ? p : walkPrune(p, selectedId)));
  }, [selectedId]);
  const canWalkNext = useMemo(
    () => !!data && !!space && walkNext(data.songs, space, dim, walkPath, selectedId) !== null,
    [data, space, dim, walkPath, selectedId]);

  // The id, not the hover object: `hover` is rebuilt on every mousemove even while the
  // pointer stays on one dot, and it is a draw dependency now.
  const hoverId = hover ? hover.song.id : null;

  // Escape clears the selection — the keyboard equivalent of the card's × button. Bound only
  // while something is selected, so this component adds no global key handler at rest.
  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setParams(withParam(params, 'song', null), { replace: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, params, setParams]);

  // Depends on `canvasEl`, not just `attachWheel`: on first load the canvas is unmounted
  // (the loading-state early return below fires instead), so the effect commit that runs
  // while `attachWheel`'s identity is fresh would otherwise attach to `null` and never
  // re-run once the canvas actually appears, leaving the wheel permanently unbound.
  const attachWheel = gesture.attachWheel;
  useEffect(() => attachWheel(canvasEl), [attachWheel, canvasEl]);

  // Switching space tweens every dot from where it is to where it belongs — that motion is
  // the answer to "which songs travel together between Thematic and Sound", which is the
  // question the map exists to raise. `from` is the last frame DRAWN, not the last space's
  // final layout, so interrupting mid-tween resumes from the current position.
  // Switching 2D <-> 3D is the same motion: every dot glides from where it is drawn to where it
  // belongs. Camera movement (orbit, drift, presets) must NOT start a tween - only these two do.
  useEffect(() => {
    if (!lastFrameRef.current || reduceMotion) return;
    tweenRef.current = { from: lastFrameRef.current, start: performance.now() };
  }, [space, dim, reduceMotion]);

  useEffect(() => {
    const canvas = canvasEl;
    if (!canvas || !data || !space) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const is3d = dim === '3d';
    // Every point carries `depth` and `k` (depth factor); in 2D they are constants, so the
    // drawing and picking code below is one path for both views.
    let target;
    if (is3d) {
      const mapped = data.songs.filter(s => s.coords3 && s.coords3[space]);
      const projected = projectCloud(mapped.map(s => s.coords3[space]), orbit.camera, size);
      target = sortBackToFront(projected.map((p, i) => ({ id: mapped[i].id, song: mapped[i], ...p })));
    } else {
      target = layout(data.songs, space, size, transform.view)
        .map(p => ({ ...p, depth: 0, k: 1 }));
    }
    const dimmed = dimColour();
    const rootStyle = getComputedStyle(document.documentElement);
    const ringColour = rootStyle.getPropertyValue('--text-primary').trim() || '#fff';
    const gizmoColour = rootStyle.getPropertyValue('--text-secondary').trim() || '#aaa';
    const haloColour = rootStyle.getPropertyValue('--bg-canvas').trim() || '#000';
    const labelFont = `600 12px ${rootStyle.getPropertyValue('--font-body').trim() || 'sans-serif'}`;
    const labelSet = (spaceMeta && (is3d ? spaceMeta.labels3d : spaceMeta.labels2d)) || [];
    const extents = is3d ? null : extentsFor(data.songs, space);
    const radiusOf = (p) => (is3d ? dotRadius(DOT_RADIUS, p.k) : DOT_RADIUS);

    const drawGizmo = () => {
      const cx = size.w - GIZMO_INSET;
      const cy = size.h - GIZMO_INSET;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 1.5;
      // Far axes first so the near ones overlap them; nearer = more opaque.
      for (const a of gizmoAxes(orbit.camera).sort((u, v) => v.depth - u.depth)) {
        const ex = cx + a.x * GIZMO_LEN;
        const ey = cy + a.y * GIZMO_LEN;
        ctx.globalAlpha = 0.9 - 0.45 * ((a.depth + 1) / 2);
        ctx.strokeStyle = gizmoColour;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.fillStyle = ringColour;
        ctx.fillText(a.axis.toUpperCase(), cx + a.x * (GIZMO_LEN + 9), cy + a.y * (GIZMO_LEN + 9));
      }
      ctx.globalAlpha = 1;
    };

    // Cluster labels: each region's centre goes through the same projection as the dots, then
    // only the ones that fit without colliding are drawn (larger regions win, so zooming in
    // reveals more). Drawn text carries a halo in the page colour so it reads over dots.
    const drawLabels = () => {
      if (!showLabels || labelSet.length === 0) return;
      const items = labelSet.map((l) => {
        if (is3d) {
          const q = projectCloud([l.centre], orbit.camera, size)[0];
          return { text: truncateLabel(l.label), x: q.x, y: q.y, count: l.count, k: q.k };
        }
        const q = projectPoint(l.centre, extents, size, transform.view);
        return { text: truncateLabel(l.label), x: q.x, y: q.y, count: l.count, k: 1 };
      });
      ctx.font = labelFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      for (const p of placeLabels(items, t => ctx.measureText(t).width,
        // keep labels clear of the year strip along the bottom edge
        { w: size.w, h: size.h - (bounds ? 40 : 0) })) {
        ctx.globalAlpha = is3d ? Math.min(1, dotAlpha(p.k) + 0.15) : 0.9;
        ctx.strokeStyle = haloColour;
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = ringColour;
        ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;
    };

    const drawFrame = (points, withLabels = true) => {
      ctx.clearRect(0, 0, size.w, size.h);
      const lit = [];
      const faint = new Set();   // no release year while a cutoff is set: drawn at half strength
      for (const p of points) {
        const passesSpotlight = songPassesSpotlight(p.song, colour, spotlit);
        const passesSearch = !matchIds || matchIds.has(p.id);
        const yState = yearState(p.song, year);
        if (yState === 'unknown') faint.add(p.id);
        if (passesSpotlight && passesSearch && yState !== 'out') lit.push(p);
        else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radiusOf(p), 0, Math.PI * 2);
          ctx.fillStyle = dimmed;
          ctx.fill();
        }
      }
      // Thin lines from the selected song to its nearest neighbours, under the lit dots so the
      // dots stay readable; fading with depth in 3D.
      if (neighbourIds && selectedId) {
        const from = points.find(p => p.id === selectedId);
        if (from) {
          ctx.lineWidth = 1;
          ctx.strokeStyle = gizmoColour;
          for (const p of points) {
            if (!neighbourIds.has(p.id)) continue;
            ctx.globalAlpha = (is3d ? dotAlpha((from.k + p.k) / 2) : 0.85) * 0.75;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
      for (const p of lit) {
        ctx.globalAlpha = (is3d ? dotAlpha(p.k) : 0.85) * (faint.has(p.id) ? 0.5 : 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.id === hoverId ? radiusOf(p) + HOVER_GROWTH : radiusOf(p),
          0, Math.PI * 2);
        ctx.fillStyle = scale(p.song.codes[colour]);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // A soft halo, drawn in the dot's own colour, so the hovered song is findable without
      // reading the card — and without a second colour entering the palette.
      if (hoverId != null) {
        const h = lit.find(p => p.id === hoverId);
        if (h) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, radiusOf(h) + HOVER_GROWTH + 3, 0, Math.PI * 2);
          ctx.globalAlpha = 0.35;
          ctx.strokeStyle = scale(h.song.codes[colour]);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      if (selectedId) {
        const hit = points.find(p => p.id === selectedId);
        if (hit) {
          ctx.beginPath();
          ctx.arc(hit.x, hit.y, radiusOf(hit) + 4, 0, Math.PI * 2);
          ctx.strokeStyle = ringColour;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      if (withLabels) drawLabels();
      if (is3d) drawGizmo();

      // What a click can hit: each dot's drawn radius and whether it is lit, so picking agrees
      // with what is painted (a dimmed dot never steals a click from a lit one under it).
      const litIds = new Set(lit.map(p => p.id));
      positionsRef.current = points.map(p => ({ ...p, r: radiusOf(p), lit: litIds.has(p.id) }));
      lastFrameRef.current = new Map(points.map(p => [p.id, { x: p.x, y: p.y }]));
    };

    let raf = 0;
    const frame = (now) => {
      const tween = tweenRef.current;
      if (!tween) { drawFrame(target); return; }
      const t = Math.min(1, (now - tween.start) / TWEEN_MS);
      const e = easeOutCubic(t);
      // Labels wait for the dots to land: during the glide they would sit at the destination
      // while their region is still travelling. The last frame (t = 1) draws them.
      drawFrame(target.map(p => {
        const from = tween.from.get(p.id);
        if (!from) return p;   // a song with no coordinates in the old space simply appears
        return { ...p, x: from.x + (p.x - from.x) * e, y: from.y + (p.y - from.y) * e };
      }), t >= 1);
      if (t < 1) raf = requestAnimationFrame(frame);
      else tweenRef.current = null;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [
    canvasEl, data, space, dim, colour, scale, size, spotlit, matchIds, selectedId,
    transform.view, orbit.camera, hoverId, spaceMeta, showLabels, neighbourIds, year, bounds,
  ]);

  // 12px grab radius; in 3D, of the dots inside it the one nearest the camera wins.
  const nearest = (mx, my) => pickPoint(positionsRef.current, mx, my, 12);

  const onMove = (e) => {
    // A pan owns the pointer; showing a hover card mid-drag is noise.
    if (gesture.onPointerMove(e)) { setHover(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const hit = nearest(e.clientX - r.left, e.clientY - r.top);
    setHover(hit ? { song: hit.song, x: hit.x, y: hit.y } : null);
  };

  // Select the walk's next (or previous) song and, only if it sits near or past the edge of the plot
  // (an unzoomed map already shows everything), ease the camera or view to centre it.
  const stepTo = (step) => {
    if (!step) return;
    setWalkPath(step.path);
    // One URL write for the song AND any snapped camera/view: separate writes in one tick would
    // each start from the same stale params and the later one would undo the song change.
    const writes = [['song', String(step.id)]];
    const point = positionsRef.current.find(p => p.id === step.id);
    if (point && outsideCore(point, size)) {
      const serialised = dim === '3d'
        ? orbit.moveTo(panCentredOn(orbit.camera, point, size), { commit: false })
        : transform.moveTo(viewCentredOn(transform.view, point, size), { commit: false });
      if (serialised != null) writes.push([dim === '3d' ? 'cam' : 'view', serialised]);
    }
    setParams(withParams(params, writes), { replace: true });
  };
  const onWalkNext = () => stepTo(walkNext(data.songs, space, dim, walkPath, selectedId));
  const onWalkBack = () => stepTo(walkBack(walkPath, selectedId));

  const onClick = (e) => {
    // `click` fires after the pointer-up that ended a pan; without this every drag would
    // also select a song.
    if (gesture.didDrag()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const hit = nearest(e.clientX - r.left, e.clientY - r.top);
    if (hit) setParam('song', String(hit.id));
  };

  if (loading) return <div className="explore-loading">Loading the map…</div>;
  if (error) {
    return (
      <div className="explore-error">
        <p>{error}</p>
        <button type="button" onClick={reload}>Try again</button>
      </div>
    );
  }

  const toggleEntry = (entry) => {
    const codes = codesOf(entry);
    const next = new Set(spotlit);
    if (codes.every(c => next.has(c))) codes.forEach(c => next.delete(c));
    else codes.forEach(c => next.add(c));
    setParam('codes', [...next].join(','));
  };

  return (
    <div className="explore-map">
      <div className="explore-toolbar">
        <span className="explore-toolbar-label">Space</span>
        <div className="explore-space-chips">
          {data.spaces.map(s => (
            <button
              key={s.key}
              type="button"
              className={`explore-chip ${s.key === space ? 'on' : ''}`}
              aria-pressed={s.key === space}
              onClick={() => setParam('space', s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="explore-colour-by">
          <span className="explore-toolbar-label">Colour by</span>
          <select value={colour || ''} onChange={(e) => setParam('colour', e.target.value)}>
            {data.colourBy.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="explore-search">
          <span className="explore-toolbar-label">Find a song</span>
          <input
            type="search"
            value={query}
            placeholder="Title or artist…"
            onChange={(e) => setParam('q', e.target.value)}
          />
        </label>
      </div>

      {spaceMeta && spaceMeta.description && (
        <p className="explore-space-note">{spaceMeta.description}</p>
      )}

      <div className="explore-body">
        <div className="explore-plot" ref={setPlotEl}>
          <canvas
            ref={setCanvasEl}
            role="img"
            className={gesture.isDragging ? 'explore-canvas grabbing' : 'explore-canvas'}
            aria-label={`${dim === '3d' ? '3D map' : 'Map'} of ${data.coverage.mapped} songs positioned by ${
              (data.spaces.find(s => s.key === space) || {}).label} similarity, coloured by ${
              (legend || {}).label}.`}
            tabIndex={dim === '3d' ? 0 : undefined}
            onPointerDown={gesture.onPointerDown}
            onPointerMove={onMove}
            onPointerUp={gesture.onPointerUp}
            onPointerLeave={() => { gesture.onPointerUp(); setHover(null); }}
            onPointerCancel={() => { gesture.onPointerCancel(); setHover(null); }}
            onContextMenu={dim === '3d' ? orbit.onContextMenu : undefined}
            onKeyDown={dim === '3d' ? orbit.onKeyDown : undefined}
            onClick={onClick}
          />
          <MapToolbar
            dim={dim}
            has3d={has3d}
            onDim={(d) => setParam('dim', d === '3d' ? '3d' : null)}
            labels={showLabels}
            onLabels={(on) => setParam('labels', on ? null : '0')}
            lines={showLines}
            onLines={(on) => setParam('lines', on ? null : '0')}
            activePreset={presetOf(orbit.camera)}
            onPreset={orbit.goToPreset}
            drift={orbit.drift}
            onDrift={orbit.setDrift}
            reduceMotion={reduceMotion}
          />
          <div className="explore-zoom">
            <button type="button" aria-label="Zoom in" onClick={gesture.zoomIn}>+</button>
            <button type="button" aria-label="Zoom out" onClick={gesture.zoomOut}>−</button>
            <button type="button" className="explore-zoom-reset" onClick={gesture.reset}>
              Reset
            </button>
          </div>
          <YearStrip
            bounds={bounds}
            year={year}
            onYear={(y) => setParam('yr', formatYear(y, bounds))}
          />
          {hover && (
            <div
              className="explore-hovercard"
              style={{
                left: Math.min(hover.x + 14, size.w - 190),
                top: Math.min(Math.max(hover.y - 10, 0), size.h - 100),
              }}
            >
              <div className="explore-song-title">{hover.song.title}</div>
              <div className="explore-song-meta">
                {hover.song.artist}{hover.song.year ? ` · ${hover.song.year}` : ''}
              </div>
              {legend && (
                <div className="explore-song-meta">
                  {legend.label}: {
                    (findLegendEntry(legend, hover.song.codes[colour]) || {}).label
                  }
                </div>
              )}
            </div>
          )}
        </div>
        <aside className="explore-rail">
          <div className="explore-rail-label">{(legend || {}).label}</div>
          <ul className="explore-legend">
            {legend && legend.codes.map(c => {
              const state = legendToggleState(c, spotlit);
              return (
                <li key={c.code}>
                  <button
                    type="button"
                    className={legendToggleClass(state, spotlit)}
                    aria-pressed={legendAriaPressed(state)}
                    onClick={() => toggleEntry(c)}
                  >
                    <span className="explore-swatch" style={{ background: scale(c.code) }} />
                    {c.label} <span className="explore-legend-count">({c.count})</span>
                  </button>
                  {c.children && c.children.length > 0 && (
                    <ul className="explore-legend-children">
                      {c.children.map(ch => {
                        const childState = legendToggleState(ch, spotlit);
                        return (
                          <li key={ch.code}>
                            <button
                              type="button"
                              className={legendToggleClass(childState, spotlit)}
                              aria-pressed={legendAriaPressed(childState)}
                              onClick={() => toggleEntry(ch)}
                            >
                              {ch.label} <span className="explore-legend-count">({ch.count})</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {legend && legend.note && <p className="explore-legend-note">{legend.note}</p>}

          {matches && (
            <div className="explore-matches">
              <div className="explore-rail-label">
                {matches.length === 0
                  ? 'No songs match'
                  : matches.length > 20
                    ? `Showing 20 of ${matches.length} matches`
                    : `${matches.length} match${matches.length === 1 ? '' : 'es'}`}
              </div>
              <ul>
                {matches.slice(0, 20).map(s => (
                  <li key={s.id}>
                    <button type="button" onClick={() => setParam('song', String(s.id))}>
                      {s.title} <span className="explore-legend-count">{s.artist}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="explore-rail-label explore-rail-label--selected">Selected</div>
          <SelectedSongCard
            song={selected}
            colourLabel={(legend || {}).label}
            colourValue={selected && legend
              ? (findLegendEntry(legend, selected.codes[colour]) || {}).label
              : null}
            onClear={() => setParam('song', null)}
            walk={{
              step: walkLength,
              canBack: walkLength > 1,
              canNext: canWalkNext,
              onNext: onWalkNext,
              onBack: onWalkBack,
            }}
          />
        </aside>
      </div>

      <p className="explore-coverage">
        Showing {data.coverage.mapped.toLocaleString()} of {data.coverage.live.toLocaleString()} songs
        — only songs the analysis has mapped appear here.
      </p>
    </div>
  );
}

export default ExploreMap;
