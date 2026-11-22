import { useState } from 'react';
import { niceMax, labelStep, nearestIndex, seriesColour } from './chartScale';

const M = { top: 8, right: 12, bottom: 24, left: 40 };

const pctText = v => `${Math.round(v * 100)}%`;

// Songs per era by parent genre, as a stacked area. `era` is dataModel.buildEraSeries' result; `mode` is 'count' | 'share'.
// A crosshair + tooltip lists every genre in the era under the pointer.
function EraChart({ width, era, mode, labelOf }) {
  const [hover, setHover] = useState(null);
  const height = width < 480 ? 240 : 300;
  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  const { eras, series } = era;
  const n = eras.length;

  // One era is drawn as a short flat band (an area needs two points).
  const xs = n === 1 ? [M.left + innerW / 2 - 24, M.left + innerW / 2 + 24] : eras.map((_, i) => M.left + (i / (n - 1)) * innerW);
  const pick = n === 1 ? [0, 0] : eras.map((_, i) => i);
  const yMax = mode === 'share' ? 1 : niceMax(Math.max(...eras.map(e => e.total), 1));
  const y = v => M.top + innerH - (v / yMax) * innerH;

  const base = eras.map(() => 0);
  const layers = series.map(s => {
    const lower = base.slice();
    s.values.forEach((v, i) => { base[i] += v; });
    return { s, lower, upper: base.slice() };
  });
  const area = ({ lower, upper }) => {
    const top = pick.map((i, k) => `${k === 0 ? 'M' : 'L'}${xs[k].toFixed(1)},${y(upper[i]).toFixed(1)}`).join(' ');
    const bottom = pick.map((_, k) => {
      const back = pick.length - 1 - k;
      return `L${xs[back].toFixed(1)},${y(lower[pick[back]]).toFixed(1)}`;
    }).join(' ');
    return `${top} ${bottom} Z`;
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * yMax);
  const every = labelStep(n, innerW);
  const fmt = mode === 'share' ? pctText : v => String(Math.round(v));
  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(e.clientX - rect.left, 0, innerW, n));
  };
  const hx = hover == null ? null : (n === 1 ? M.left + innerW / 2 : xs[hover]);

  return (
    <div className="data-svg-wrap">
      <svg width={width} height={height} role="img" aria-label="Songs per era by parent genre, stacked area chart. A table view is available.">
        {ticks.map(t => (
          <g key={t}>
            <line className="data-grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text className="data-axis" x={M.left - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {layers.map(l => (
          <path key={l.s.key} d={area(l)} style={{ fill: seriesColour(l.s), stroke: 'var(--bg-surface)', strokeWidth: 1.5 }} />
        ))}
        {eras.map((e, i) => (i % every === 0 ? (
          <text key={e.start} className="data-axis" x={n === 1 ? M.left + innerW / 2 : xs[i]} y={height - 6} textAnchor={xs[i] > width - 30 ? 'end' : 'middle'}>{e.label}</text>
        ) : null))}
        {hx != null && <line className="data-cross" x1={hx} x2={hx} y1={M.top} y2={M.top + innerH} />}
        <rect x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="data-tip" style={{ left: Math.min(Math.max(hx + 10, 0), width - 190), top: 0 }}>
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
