import ChartFrame from '../ChartFrame';
import useSeen from './useSeen';
import { barRows, chartTable, colourVar, decadeLabel } from './storyModel';

// The share of songs carrying each code in one decade. The bars grow the first time the panel is seen; the grey tick on
// each bar is where that code stood in the previous decade.
function DecadeBarsPanel({ chart, slots }) {
  const { ref, seen } = useSeen(0.25);
  const rows = barRows(chart);
  return (
    <section className="story-panel" ref={ref}>
      <ChartFrame title={`The ${decadeLabel(chart.decade)}`} caption={chart.caption} table={chartTable(chart)}>
        {() => (
          <ul className="story-bars">
            {rows.map((r) => (
              <li key={r.code}>
                <span className="story-bar-label">{r.label}</span>
                <span className="story-bar-track">
                  <i className="story-bar-fill" style={{ width: seen ? `${r.pct}%` : '0%', background: colourVar(slots, r.code) }} />
                  {r.ghostPct != null && <b className="story-bar-ghost" style={{ left: `${r.ghostPct}%` }} aria-hidden="true" />}
                </span>
                <span className="story-bar-value">{r.pct}%</span>
                {r.deltaText && <span className="story-bar-delta">{r.deltaText}</span>}
              </li>
            ))}
          </ul>
        )}
      </ChartFrame>
    </section>
  );
}

export default DecadeBarsPanel;
