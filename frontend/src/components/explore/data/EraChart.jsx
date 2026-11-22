import { useState } from 'react';
import { niceMax, labelStep, seriesColour } from './chartScale';

const M = { top: 8, right: 12, bottom: 24, left: 40 };

const pctText = v => `${Math.round(v * 100)}%`;

// Songs per era by parent genre, as stacked bars. `era` is dataModel.buildEraSeries' result; `mode` is 'count' | 'share'.
// Hovering a bar highlights its era and lists every genre in it.
function EraChart({ width, era, mode, labelOf }) {
  const [hover, setHover] = useState(null);
  const height = width < 480 ? 240 : 300;
  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  const { eras, series } = era;
  const n = eras.length;

  const band = innerW / n;
  const barW = Math.max(2, Math.min(band * 0.78, 56));
  const cx = i => M.left + (i + 0.5) * band;
  const yMax = mode === 'share' ? 1 : niceMax(Math.max(...eras.map(e => e.total), 1));
  const y = v => M.top + innerH - (v / yMax) * innerH;

  // Stack in series order; each segment is [lower, upper] for one era.
  const base = eras.map(() => 0);
  const layers = series.map(s => ({
    s,
    segs: s.values.map((v, i) => {
      const lower = base[i];
      base[i] += v;
      return { lower, upper: base[i] };
    }),
  }));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * yMax);
  const every = labelStep(n + 1, innerW);
  const fmt = mode === 'share' ? pctText : v => String(Math.round(v));
  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.floor((e.clientX - rect.left) / band))));
  };

  return (
    <div className="data-svg-wrap">
      <svg width={width} height={height} role="img" aria-label="Songs per era by parent genre, stacked bar chart. A table view is available.">
        {ticks.map(t => (
          <g key={t}>
            <line className="data-grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text className="data-axis" x={M.left - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {hover != null && <rect className="data-band" x={M.left + hover * band} y={M.top} width={band} height={innerH} />}
        {layers.map(l => (
          <g key={l.s.key} style={{ fill: seriesColour(l.s) }}>
            {l.segs.map((g, i) => (g.upper > g.lower ? (
              <rect key={i} x={cx(i) - barW / 2} y={y(g.upper)} width={barW} height={Math.max(0, y(g.lower) - y(g.upper))}
                style={{ stroke: 'var(--bg-surface)', strokeWidth: 1 }} />
            ) : null))}
          </g>
        ))}
        {eras.map((e, i) => (i % every === 0 ? (
          <text key={e.start} className="data-axis" x={cx(i)} y={height - 6} textAnchor={cx(i) > width - 30 ? 'end' : 'middle'}>{e.label}</text>
        ) : null))}
        <rect x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="data-tip" style={{ left: Math.min(Math.max(cx(hover) + barW / 2 + 8, 0), width - 190), top: 0 }}>
          <strong>{eras[hover].label}</strong>
          <div>{eras[hover].total} songs</div>
          {[...series].reverse().map(s => (
            <div key={s.key} className="data-tip-row">
              <span className="data-swatch" style={{ background: seriesColour(s) }} aria-hidden="true" />
              {labelOf(s.key)} <span className="data-tip-val">{mode === 'share' ? pctText(s.values[hover]) : s.values[hover]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default EraChart;
