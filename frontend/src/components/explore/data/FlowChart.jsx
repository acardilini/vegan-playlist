import { useMemo, useState } from 'react';
import { flowLayout } from './flowModel';
import { noun } from './flowPin';

const NODE_W = 14;
const TOP = 24;        // room above the nodes for the column names
const LABEL_LINE = 14; // minimum vertical distance between two labels in a column

const slotColour = node => (node.other || node.slot == null ? 'var(--explore-not-coded)' : `var(--explore-cat-${node.slot + 1})`);

const clip = (text, room) => (text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`);

// The flow's labels sit beside their node; push overlapping ones apart (top to bottom, then back up from the bottom edge).
function labelYs(nodes, height) {
  const ys = nodes.map(n => n.y + n.h / 2 + 4);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + LABEL_LINE);
  const cap = height - 2;
  if (ys.length && ys[ys.length - 1] > cap) {
    ys[ys.length - 1] = cap;
    for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - LABEL_LINE);
  }
  return ys;
}

const ribbonId = r => `${r.fromCol}|${r.from}|${r.to}`;

// Midpoint of a ribbon's centre line (a cubic Bezier from (x0,y0) to (x1,y1) with level tangents): used to anchor its tooltip.
function midpoint(d) {
  const v = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return { x: (v[0] + v[6]) / 2, y: (v[1] + v[7]) / 2 };
}

// The three-column flow. Colour sits on column 0 (a node and the ribbons leaving it), the folded Other node is grey, and
// ribbons between columns 1 and 2 are a quiet neutral. Labels are always text-coloured. Nodes and ribbons are focusable
// buttons; hover or focus fades what is unrelated, and a click or Enter pins the selection (held by the parent).
function FlowChart({ width, flow, pin, onPin }) {
  const [hover, setHover] = useState(null); // {kind:'node',col,key} | {kind:'ribbon',id,mid}
  const height = 380;
  const labelPad = Math.min(190, Math.round(width * 0.2));
  const layout = useMemo(
    () => flowLayout(flow, { width, height, nodeWidth: NODE_W, gap: 12, labelPad }),
    [flow, width, labelPad],
  );
  const nodeAt = (col, key) => layout.nodes.find(n => n.col === col && n.key === key);
  const labelOf = (col, key) => (nodeAt(col, key) ? nodeAt(col, key).label : key);
  const pct = n => Math.round((n / flow.n) * 100);

  const touches = (r) => {
    if (!hover) return true;
    if (hover.kind === 'ribbon') return hover.id === ribbonId(r);
    return (r.fromCol === hover.col && r.from === hover.key) || (r.fromCol + 1 === hover.col && r.to === hover.key);
  };

  const pinnedNode = (n) => pin && pin.type === 'node' && pin.col === n.col && pin.key === n.key;
  const pinnedRibbon = (r) => pin && pin.type === 'ribbon' && pin.fromCol === r.fromCol && pin.from === r.from && pin.to === r.to;
  const toggle = (next, isPinned) => onPin(isPinned ? null : next);
  const onKey = (e, act) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
  };

  const colNodes = [0, 1, 2].map(c => layout.nodes.filter(n => n.col === c));
  const labelY = new Map();
  colNodes.forEach(nodes => labelYs(nodes, height).forEach((y, i) => labelY.set(`${nodes[i].col}|${nodes[i].key}`, y)));

  const tipRibbon = hover && hover.kind === 'ribbon' ? layout.ribbons.find(r => ribbonId(r) === hover.id) : null;
  const tipPos = tipRibbon ? midpoint(tipRibbon.d) : null;

  return (
    <div className="data-svg-wrap">
      <svg width={width} height={height + TOP} role="group" aria-label={`Flow of songs from ${flow.columns[0].name} to ${flow.columns[1].name} to ${flow.columns[2].name}. A table view is available.`}>
        <g transform={`translate(0,${TOP})`}>
          {layout.ribbons.map((r) => {
            const id = ribbonId(r);
            const a = nodeAt(r.fromCol, r.from);
            const colour = r.fromCol === 0 ? slotColour(a) : 'var(--text-muted)';
            const on = hover && hover.kind === 'ribbon' && hover.id === id;
            const isPinned = pinnedRibbon(r);
            const cls = ['data-arg-ribbon', r.fromCol === 0 ? 'is-c0' : 'is-c1', hover && !touches(r) ? 'is-faded' : '', on || (hover && hover.kind === 'node' && touches(r)) || isPinned ? 'is-on' : ''].join(' ');
            const aria = `${labelOf(r.fromCol, r.from)} to ${labelOf(r.fromCol + 1, r.to)}: ${r.n} ${noun(r.n)}, ${pct(r.n)}% of the pathway songs`;
            const pinRibbon = { type: 'ribbon', fromCol: r.fromCol, from: r.from, to: r.to };
            return (
              <g key={id}>
                {(isPinned || on) && <path d={r.d} fill="none" className="data-arg-casing" strokeWidth={r.thickness + 3} />}
                <path d={r.d} fill="none" className={cls} style={{ stroke: colour }} strokeWidth={Math.max(1, r.thickness)} />
                <path
                  d={r.d} fill="none" className="data-arg-hit" strokeWidth={Math.max(r.thickness, 8)}
                  role="button" tabIndex={0} aria-label={aria} aria-pressed={!!isPinned}
                  onPointerEnter={() => setHover({ kind: 'ribbon', id })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ kind: 'ribbon', id })}
                  onBlur={() => setHover(null)}
                  onClick={() => toggle(pinRibbon, isPinned)}
                  onKeyDown={e => onKey(e, () => toggle(pinRibbon, isPinned))}
                />
              </g>
            );
          })}
        {layout.nodes.map((n) => {
          const isPinned = pinnedNode(n);
          const y = labelY.get(`${n.col}|${n.key}`);
          const left = n.col === 0;
          const room = Math.floor((left || n.col === 2 ? labelPad - 10 : 130) / 5.8);
          const text = clip(n.label, Math.max(4, room - String(n.n).length - 1));
          const pinNode = { type: 'node', col: n.col, key: n.key };
          const aria = `${flow.columns[n.col].name}: ${n.label}, ${n.n} ${noun(n.n)}, ${pct(n.n)}% of the pathway songs`;
          return (
            <g key={`${n.col}|${n.key}`}>
              <text className="data-arg-label" x={left ? n.x - 6 : n.x + n.w + 6} y={y} textAnchor={left ? 'end' : 'start'}>
                {text} <tspan className="data-arg-count">{n.n}</tspan>
              </text>
              <rect
                className={`data-arg-node ${isPinned ? 'is-pinned' : ''}`} x={n.x} y={n.y} width={n.w} height={Math.max(1, n.h)}
                style={{ fill: n.col === 0 ? slotColour(n) : 'var(--text-muted)' }}
                role="button" tabIndex={0} aria-label={aria} aria-pressed={!!isPinned}
                onPointerEnter={() => setHover({ kind: 'node', col: n.col, key: n.key })}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover({ kind: 'node', col: n.col, key: n.key })}
                onBlur={() => setHover(null)}
                onClick={() => toggle(pinNode, isPinned)}
                onKeyDown={e => onKey(e, () => toggle(pinNode, isPinned))}
              >
                <title>{n.label}</title>
              </rect>
            </g>
          );
        })}
        </g>
        {flow.columns.map((c, i) => (
          <text key={c.name} className="data-axis" x={i === 0 ? labelPad : i === 2 ? width - labelPad : width / 2}
            y={12} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{c.name}</text>
        ))}
      </svg>
      {tipRibbon && (
        <div className="data-tip" style={{ left: Math.min(Math.max(tipPos.x - 80, 0), Math.max(0, width - 240)), top: Math.max(0, tipPos.y + TOP - 44) }}>
          {`${labelOf(tipRibbon.fromCol, tipRibbon.from)} to ${labelOf(tipRibbon.fromCol + 1, tipRibbon.to)}: ${tipRibbon.n} ${noun(tipRibbon.n)}, ${pct(tipRibbon.n)}% of the pathway songs`}
        </div>
      )}
    </div>
  );
}

export default FlowChart;
