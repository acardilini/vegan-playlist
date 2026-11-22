import ChartFrame from '../ChartFrame';
import Legend from '../Legend';
import LineChart from '../LineChart';
import useSeen from './useSeen';
import { chartTable, colourVar, decadeLabel, linesDomain } from './storyModel';

// Chosen codes across the decades. Lines draw in the first time the panel is seen. The chart starts at the first decade
// that has enough songs to plot; the Table view still lists every decade.
function DecadeLinesPanel({ chart, slots }) {
  const { ref, seen } = useSeen(0.25);
  const first = Math.max(0, chart.decades.findIndex((d) => d.plot));
  const decades = chart.decades.slice(first);
  const series = chart.series.map((s) => ({
    key: s.code, label: s.label, colour: colourVar(slots, s.code), code: s.code, values: s.values.slice(first),
  }));
  return (
    <section className="story-panel" ref={ref}>
      <ChartFrame
        title="Across the decades"
        legend={<Legend items={series.map((s) => ({ key: s.key, label: s.label, colour: s.colour }))} />}
        caption={chart.caption}
        table={chartTable(chart)}
      >
        {(width) => (
          <div className={`story-lines ${seen ? 'is-seen' : ''}`}>
            <LineChart
              width={width}
              xs={decades.map((d) => ({ key: d.decade, label: decadeLabel(d.decade) }))}
              series={series}
              domain={linesDomain(series)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        )}
      </ChartFrame>
    </section>
  );
}

export default DecadeLinesPanel;
