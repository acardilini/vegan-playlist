import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useExplorePoints } from './useExplorePoints';
import { colourScale, dimColour } from './palette';
import SelectedSongCard from './SelectedSongCard';

const DOT_RADIUS = 3.2;
const PAD = 18;

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

// Each space is projected on its own scale (audio_2d x spans -2.9..12.3 where
// holistic_2d spans -4.7..5.1), so extents are recomputed per space — never assume a
// shared domain.
function extentsFor(songs, spaceKey) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of songs) {
    const c = s.coords[spaceKey];
    if (!c) continue;
    if (c[0] < minX) minX = c[0];
    if (c[0] > maxX) maxX = c[0];
    if (c[1] < minY) minY = c[1];
    if (c[1] > maxY) maxY = c[1];
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  if (minX === maxX) { minX -= 0.5; maxX += 0.5; }
  if (minY === maxY) { minY -= 0.5; maxY += 0.5; }
  return { minX, maxX, minY, maxY };
}

function ExploreMap() {
  const { data, loading, error, reload } = useExplorePoints();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const positionsRef = useRef([]);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [hover, setHover] = useState(null);   // { song, x, y }

  const [params, setParams] = useSearchParams();

  // A space from the URL is honoured only if the catalogue still serves it. Without this,
  // a link shared before a space was retired draws an empty plot with no chip lit.
  const requestedSpace = params.get('space');
  const space = (data && data.spaces.some(s => s.key === requestedSpace) ? requestedSpace : null)
    || (data && data.spaces[0] && data.spaces[0].key) || null;
  const colour = params.get('colour')
    || (data && (data.colourBy.find(c => c.key === 'sonic_energy') || data.colourBy[0] || {}).key)
    || null;
  const query = params.get('q') || '';
  const selectedId = params.get('song') ? Number(params.get('song')) : null;
  const spotlit = useMemo(() => {
    const raw = params.get('codes');
    return new Set(raw ? raw.split(',').filter(Boolean) : []);
  }, [params]);

  // One writer for every param, so a change never clobbers its neighbours.
  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value == null || value === '') next.delete(key);
    else next.set(key, value);
    // Changing the colour dimension invalidates a spotlight expressed in its codes.
    if (key === 'colour') next.delete('codes');
    setParams(next, { replace: true });
  };

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

  const scale = useMemo(
    () => colourScale(legend ? legend.codes : [], legend && legend.label),
    [legend]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return null;   // null = "no query", distinct from "no matches"
    return data.songs.filter(s =>
      s.title.toLowerCase().includes(q) || (s.artist || '').toLowerCase().includes(q));
  }, [data, query]);

  const matchIds = useMemo(
    () => (matches ? new Set(matches.map(s => s.id)) : null), [matches]);

  const selected = useMemo(
    () => (data && selectedId ? data.songs.find(s => s.id === selectedId) || null : null),
    [data, selectedId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || !space) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const { minX, maxX, minY, maxY } = extentsFor(data.songs, space);
    const sx = (size.w - PAD * 2) / (maxX - minX);
    const sy = (size.h - PAD * 2) / (maxY - minY);

    const dim = dimColour();
    const positions = [];
    const lit = [];
    for (const song of data.songs) {
      const c = song.coords[space];
      if (!c) continue;
      const x = PAD + (c[0] - minX) * sx;
      // Canvas y grows downward; flip so the plot reads like a chart.
      const y = size.h - PAD - (c[1] - minY) * sy;
      positions.push({ id: song.id, x, y });
      const passesSpotlight = spotlit.size === 0 || spotlit.has(song.codes[colour]);
      const passesSearch = !matchIds || matchIds.has(song.id);
      if (passesSpotlight && passesSearch) lit.push({ song, x, y });
      else {
        ctx.beginPath();
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
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
    positionsRef.current = positions;

    if (selectedId) {
      const hit = positions.find(p => p.id === selectedId);
      if (hit) {
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, DOT_RADIUS + 4, 0, Math.PI * 2);
        ctx.strokeStyle = getComputedStyle(document.documentElement)
          .getPropertyValue('--text-primary').trim() || '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [data, space, colour, scale, size, spotlit, matchIds, selectedId]);

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
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = nearest(mx, my);
    if (!hit) { setHover(null); return; }
    const song = data.songs.find(s => s.id === hit.id);
    setHover(song ? { song, x: hit.x, y: hit.y } : null);
  };

  const onClick = (e) => {
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

      <div className="explore-body">
        <div className="explore-plot" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Map of ${data.coverage.mapped} songs positioned by ${
              (data.spaces.find(s => s.key === space) || {}).label} similarity, coloured by ${
              (legend || {}).label}.`}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onClick={onClick}
          />
          {hover && (
            <div
              className="explore-hovercard"
              style={{
                left: Math.min(hover.x + 14, size.w - 190),
                top: Math.max(hover.y - 10, 0),
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
                {matches.length === 0 ? 'No songs match' : `${matches.length} match${matches.length === 1 ? '' : 'es'}`}
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
