import { useEffect, useMemo, useRef, useState } from 'react';
import { useExplorePoints } from './useExplorePoints';
import { colourScale } from './palette';

const DOT_RADIUS = 3.2;
const PAD = 18;

// Each space is projected on its own scale (semantic_2d x spans -3.6..14.0 where
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
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [space, setSpace] = useState(null);
  const [colour, setColour] = useState(null);

  // Default to the first discovered space and to Energy when it exists.
  useEffect(() => {
    if (!data) return;
    setSpace(prev => prev || (data.spaces[0] && data.spaces[0].key));
    setColour(prev => prev ||
      (data.colourBy.find(c => c.key === 'sonic_energy') || data.colourBy[0] || {}).key);
  }, [data]);

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
    () => colourScale(legend ? legend.codes.map(c => c.code) : [], legend && legend.label),
    [legend]);

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

    for (const song of data.songs) {
      const c = song.coords[space];
      if (!c) continue;
      const x = PAD + (c[0] - minX) * sx;
      // Canvas y grows downward; flip so the plot reads like a chart.
      const y = size.h - PAD - (c[1] - minY) * sy;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = scale(song.codes[colour]);
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, [data, space, colour, scale, size]);

  if (loading) return <div className="explore-loading">Loading the map…</div>;
  if (error) {
    return (
      <div className="explore-error">
        <p>{error}</p>
        <button type="button" onClick={reload}>Try again</button>
      </div>
    );
  }

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
              onClick={() => setSpace(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="explore-colour-by">
          <span className="explore-toolbar-label">Colour by</span>
          <select value={colour || ''} onChange={(e) => setColour(e.target.value)}>
            {data.colourBy.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
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
          />
        </div>
        <aside className="explore-rail">
          <div className="explore-rail-label">{(legend || {}).label}</div>
          <ul className="explore-legend">
            {legend && legend.codes.map(c => (
              <li key={c.code}>
                <span className="explore-swatch" style={{ background: scale(c.code) }} />
                {c.label} <span className="explore-legend-count">({c.count})</span>
              </li>
            ))}
          </ul>
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
