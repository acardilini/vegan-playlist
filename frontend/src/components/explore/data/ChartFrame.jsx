import { useState } from 'react';
import useWidth from './useWidth';

// The card around every Data chart: title, optional legend, the chart (drawn at the container's real width), a caption
// that states what the chart is based on, and a Table view of the same numbers.
function ChartFrame({ title, controls, legend, caption, table, empty, children }) {
  const [ref, width] = useWidth();
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="data-card">
      <header className="data-card-head">
        <h2>{title}</h2>
        {!empty && (
          <button type="button" className="data-table-toggle" aria-pressed={showTable} onClick={() => setShowTable(v => !v)}>
            {showTable ? 'Chart' : 'Table'}
          </button>
        )}
      </header>
      {controls}
      {!empty && !showTable && legend}
      <div ref={ref} className="data-chart">
        {empty && <p className="data-empty">{empty}</p>}
        {!empty && showTable && (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr>{table.head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody>
            </table>
          </div>
        )}
        {!empty && !showTable && width > 0 && children(width)}
      </div>
      <p className="data-caption">{caption}</p>
    </section>
  );
}

export default ChartFrame;
