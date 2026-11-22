import { useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  genreRanking, computeKpis, buildEraSeries, buildToneByDecade, insightSentences, MIN_POINT_N,
} from './dataModel';
import { seriesColour } from './chartScale';
import ChartFrame from './ChartFrame';
import Legend from './Legend';
import EraChart from './EraChart';
import LineChart from './LineChart';

const pct = v => `${Math.round(v * 100)}%`;

function Toggle({ label, value, options, onChange }) {
  return (
    <div className="data-toggle" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

function OverTimeTab() {
  const { songs, allSongs, labels, state, setState } = useOutletContext();
  const genreName = k => (k === 'other' ? 'Other' : labels.genres[k] || k);
  const toneName = k => (k === 'other' ? 'Other' : labels.tone[k] || k);

  // Colours follow the entity: the fixed order comes from the WHOLE catalogue, so filtering never repaints a genre or tone.
  const genreOrder = useMemo(() => genreRanking(allSongs).map(r => r.g), [allSongs]);
  const toneOrder = useMemo(() => buildToneByDecade(allSongs).series.filter(s => s.key !== 'other').map(s => s.key), [allSongs]);

  const kpis = useMemo(() => computeKpis(songs), [songs]);
  const era = useMemo(() => buildEraSeries(songs, { bucket: state.eraBucket, mode: state.eraMode, order: genreOrder }), [songs, state.eraBucket, state.eraMode, genreOrder]);
  const tone = useMemo(() => buildToneByDecade(songs, { order: toneOrder }), [songs, toneOrder]);
  const insights = useMemo(() => (state.pg ? [] : insightSentences(songs, labels.genres)), [songs, labels.genres, state.pg]);

  const eraTable = {
    head: ['Era', 'Songs', ...era.series.map(s => genreName(s.key))],
    rows: era.eras.map((e, i) => [e.label, e.total, ...era.series.map(s => (state.eraMode === 'share' ? pct(s.values[i]) : s.values[i]))]),
  };
  const eraControls = (
    <div className="data-controls">
      <Toggle label="Show as" value={state.eraMode} options={[['count', 'Songs'], ['share', 'Share']]} onChange={v => setState({ eraMode: v })} />
      <Toggle label="Group by" value={state.eraBucket} options={[['5y', '5 years'], ['1y', 'Each year']]} onChange={v => setState({ eraBucket: v })} />
    </div>
  );

  const toneMax = Math.max(0, ...tone.series.flatMap(s => s.values.filter(v => v != null)));
  const toneDomain = [0, Math.min(1, Math.max(0.2, Math.ceil(toneMax * 5) / 5))];
  const toneSeries = tone.series.map(s => ({ key: s.key, label: toneName(s.key), colour: seriesColour(s), values: s.values }));
  const toneTable = {
    head: ['Decade', 'Songs', ...toneSeries.map(s => s.label)],
    rows: tone.decades.map((d, i) => [`${d.decade}s`, d.n, ...toneSeries.map(s => (s.values[i] == null ? 'too few' : pct(s.values[i])))]),
  };
  const hasTonePoints = tone.decades.some(d => d.plot);

  return (
    <div className="data-tab">
      <ChartFrame
        title="Songs by era and genre"
        controls={eraControls}
        legend={<Legend items={era.series.map(s => ({ key: s.key, label: genreName(s.key), colour: seriesColour(s) }))} />}
        empty={era.eras.length ? null : 'No songs with a release year and a genre in this slice.'}
        table={eraTable}
        caption={`Based on ${era.n} of ${kpis.songs} songs in this slice: those with both a release year and a genre.`}
      >
        {width => <EraChart width={width} era={era} mode={state.eraMode} labelOf={genreName} />}
      </ChartFrame>
      {insights.length > 0 && <div className="data-insights">{insights.map(t => <p key={t}>{t}</p>)}</div>}

      <ChartFrame
        title="Lyrical tone by decade"
        legend={<Legend items={toneSeries.map(s => ({ key: s.key, label: s.label, colour: s.colour }))} />}
        empty={hasTonePoints ? null : `No decade has ${MIN_POINT_N} or more lyric-coded songs in this slice.`}
        table={toneTable}
        caption={`Based on ${tone.n} lyric-coded songs with a tone and a release year. Decades with fewer than ${MIN_POINT_N} such songs are not plotted.`}
      >
        {width => (
          <LineChart width={width} xs={tone.decades.map(d => ({ key: d.decade, label: `${d.decade}s` }))}
            series={toneSeries} domain={toneDomain} format={pct} />
        )}
      </ChartFrame>

    </div>
  );
}

export default OverTimeTab;
