import { topPathways } from './flowModel';
import { noun } from './flowPin';

// The phone replacement for the flow: the most common pathways as rows, each with a bar scaled to the largest.
// Selecting a row pins the same detail line the SVG's nodes and ribbons do.
function PathwayList({ flow, pin, onPin }) {
  const rows = topPathways(flow);
  if (!rows.length) return <p className="data-empty">No pathway here is made only of named nodes.</p>;
  const max = rows[0].n;
  const key = p => p.keys.join('\u0001');
  const pinned = pin && pin.type === 'path' ? pin.keys.join('\u0001') : null;
  return (
    <ul className="data-arg-paths">
      {rows.map(p => (
        <li key={key(p)}>
          <button type="button" className="data-arg-path" aria-pressed={pinned === key(p)} onClick={() => onPin({ type: 'path', keys: p.keys })}>
            <span className="data-arg-path-label">{p.labels.join(' > ')}</span>
            <span className="data-arg-path-count">{p.n} {noun(p.n)}</span>
            <span className="data-arg-bar" aria-hidden="true"><span style={{ width: `${(p.n / max) * 100}%` }} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default PathwayList;
