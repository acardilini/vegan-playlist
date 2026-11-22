import { useState } from 'react';
import { labelStep, nearestIndex } from './chartScale';

const M = { top: 10, right: 14, bottom: 24, left: 44 };

// Lines over decades. `xs` = [{key, label}]; `series` = [{key, label, colour, values}] (null = withheld, which breaks the
// line); `domain` = [min, max] of the y axis; `format` formats a value. Used for tone shares and for median tempo/loudness.
function LineChart({ width, xs, series, domain, format, unit = '' }) {
  const [hover, setHover] = useState(null);
  const height = width < 480 ? 200 : 240;
  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  const n = xs.length;
  const px = i => M.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const [lo, hi] = domain;
  const y = v => M.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + f * (hi - lo));
  const every = labelStep(n, innerW);

  // Runs of consecutive non-null values; a lone point is drawn as a marker only.
  const runs = vals => {
    const out = [];
    let cur = [];
    vals.forEach((v, i) => {
      if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push(i);
    });
    if (cur.length) out.push(cur);
    return out;
  };

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(nearestIndex(e.clientX - rect.left, 0, innerW, n));
  };

  return (
    <div className="data-svg-wrap">
      <svg width={width} height={height} role="img" aria-label="Line chart by decade. A table view is available.">
        {ticks.map(t => (
          <g key={t}>
            <line className="data-grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text className="data-axis" x={M.left - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {xs.map((x, i) => (i % every === 0 ? (
          <text key={x.key} className="data-axis" x={px(i)} y={height - 6} textAnchor={px(i) > width - 30 ? 'end' : 'middle'}>{x.label}</text>
        ) : null))}
        {series.map(s => (
          <g key={s.key}>
            {runs(s.values).map(run => (run.length > 1 ? (
              <polyline key={run[0]} fill="none" style={{ stroke: s.colour, strokeWidth: 2 }}
                points={run.map(i => `${px(i).toFixed(1)},${y(s.values[i]).toFixed(1)}`).join(' ')} />
            ) : null))}
            {s.values.map((v, i) => (v == null ? null : (
              <circle key={i} cx={px(i)} cy={y(v)} r={4} style={{ fill: s.colour, stroke: 'var(--bg-surface)', strokeWidth: 2 }} />
            )))}
          </g>
        ))}
        {hover != null && <line className="data-cross" x1={px(hover)} x2={px(hover)} y1={M.top} y2={M.top + innerH} />}
        <rect x={M.left} y={M.top} width={innerW} height={innerH} fill="transparent"
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="data-tip" style={{ left: Math.min(Math.max(px(hover) + 10, 0), width - 190), top: 0 }}>
          <strong>{xs[hover].label}</strong>
          {series.map(s => (
            <div key={s.key} className="data-tip-row">
              <span className="data-swatch" style={{ background: s.colour }} aria-hidden="true" />
              {s.label} <span className="data-tip-val">{s.values[hover] == null ? 'too few songs' : `${format(s.values[hover])}${unit}`}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LineChart;
