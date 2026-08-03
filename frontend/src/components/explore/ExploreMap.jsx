import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useExplorePoints } from './useExplorePoints';
import { colourScale, dimColour } from './palette';
import SelectedSongCard from './SelectedSongCard';
import { layout } from './mapGeometry';
import { useMapTransform } from './useMapTransform';
import {
  deriveColour, deriveQuery, deriveSelectedId, deriveSpace, deriveSpotlit, withParam,
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

function ExploreMap() {
  const { data, loading, error, reload } = useExplorePoints();
  // State, not a plain ref: while `data` is loading this component returns early and the
  // canvas never mounts, so a ref alone would sit at null through that render with nothing
  // to notice when it later attaches. Tracking the element in state makes its arrival a
  // dependency the wheel-attach effect below can react to.
  const [canvasEl, setCanvasEl] = useState(null);
  const wrapRef = useRef(null);
  const positionsRef = useRef([]);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [hover, setHover] = useState(null);   // { song, x, y }

  const [params, setParams] = useSearchParams();

  // Every rule about what the URL may say lives in exploreUrlState.js — see the comment
  // there for why this is not inlined.
  const space = data ? deriveSpace(params, data.spaces) : null;
  const colour = data ? deriveColour(params, data.colourBy) : null;
  const query = deriveQuery(params);
  const selectedId = deriveSelectedId(params);
  const spotlit = useMemo(() => deriveSpotlit(params), [params]);

  const setParam = useCallback((key, value) => {
    setParams(withParam(params, key, value), { replace: true });
  }, [params, setParams]);

  // The viewport is committed to the URL at the end of a gesture, never per pixel — a pan
  // writing 60 history entries would make Back useless.
  const commitView = useCallback((serialised) => setParam('view', serialised), [setParam]);
  const transform = useMapTransform({ size, params, onCommit: commitView });

  // Track the plot box so the canvas can be backing-store accurate.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: Math.max(240, r.width), h: Math.max(280, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const { attachWheel } = transform;
  useEffect(() => attachWheel(canvasEl), [attachWheel, canvasEl]);

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

    const points = layout(data.songs, space, size, transform.view);
    const dim = dimColour();
    const lit = [];
    for (const p of points) {
      const passesSpotlight = spotlit.size === 0 || spotlit.has(p.song.codes[colour]);
      const passesSearch = !matchIds || matchIds.has(p.id);
      if (passesSpotlight && passesSearch) lit.push(p);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = dim;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 0.85;
    for (const p of lit) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = scale(p.song.codes[colour]);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    positionsRef.current = points;

    if (selectedId) {
      const hit = points.find(p => p.id === selectedId);
      if (hit) {
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, DOT_RADIUS + 4, 0, Math.PI * 2);
        ctx.strokeStyle = getComputedStyle(document.documentElement)
          .getPropertyValue('--text-primary').trim() || '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [canvasEl, data, space, colour, scale, size, spotlit, matchIds, selectedId, transform.view]);

  const nearest = (mx, my) => {
    let best = null, bestD = 12 * 12;   // 12px grab radius, squared
    for (const p of positionsRef.current) {
      const dx = p.x - mx, dy = p.y - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  };

  const onMove = (e) => {
    // A pan owns the pointer; showing a hover card mid-drag is noise.
    if (transform.onPointerMove(e)) { setHover(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const hit = nearest(e.clientX - r.left, e.clientY - r.top);
    setHover(hit ? { song: hit.song, x: hit.x, y: hit.y } : null);
  };

  const onClick = (e) => {
    // `click` fires after the pointer-up that ended a pan; without this every drag would
    // also select a song.
    if (transform.didDrag()) return;
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
        <div className="explore-plot" ref={wrapRef}>
          <canvas
            ref={setCanvasEl}
            role="img"
            className={transform.isDragging ? 'explore-canvas grabbing' : 'explore-canvas'}
            aria-label={`Map of ${data.coverage.mapped} songs positioned by ${
              (data.spaces.find(s => s.key === space) || {}).label} similarity, coloured by ${
              (legend || {}).label}.`}
            onPointerDown={transform.onPointerDown}
            onPointerMove={onMove}
            onPointerUp={transform.onPointerUp}
            onPointerLeave={() => { transform.onPointerUp(); setHover(null); }}
            onClick={onClick}
          />
          <div className="explore-zoom">
            <button type="button" aria-label="Zoom in" onClick={transform.zoomIn}>+</button>
            <button type="button" aria-label="Zoom out" onClick={transform.zoomOut}>−</button>
            <button type="button" className="explore-zoom-reset" onClick={transform.reset}>
              Reset
            </button>
          </div>
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

          <div className="explore-rail-label">Selected</div>
          <SelectedSongCard
            song={selected}
            colourLabel={(legend || {}).label}
            colourValue={selected && legend
              ? (findLegendEntry(legend, selected.codes[colour]) || {}).label
              : null}
            onClear={() => setParam('song', null)}
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
