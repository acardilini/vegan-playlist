import { Link } from 'react-router-dom';
import { browseHref } from '../../../utils/dataUrlState';

// The one slice every Data tab reads: a parent genre and a release-year window, with a single line saying what the slice
// holds and a link to browse those songs. Two range inputs share one track (the classes are the map's YearStrip ones).
function DataFilterBar({ bounds, genres, labels, state, setState, kpis }) {
  const flat = bounds.min === bounds.max;
  const span = bounds.max - bounds.min || 1;
  const pct = v => ((v - bounds.min) / span) * 100;
  const startOnTop = state.yf > bounds.min + span / 2;

  return (
    <div className="data-filter" role="group" aria-label="Slice of the catalogue">
      <label className="data-filter-genre">
        <span>Genre</span>
        <select value={state.pg} onChange={e => setState({ pg: e.target.value })}>
          <option value="">All genres</option>
          {genres.map(g => <option key={g.g} value={g.g}>{labels.genres[g.g] || g.g}</option>)}
        </select>
      </label>

      <div className="data-filter-years">
        <span className="data-filter-years-label">{state.yf === state.yt ? state.yf : `${state.yf}–${state.yt}`}</span>
        <div className="explore-yearstrip-dual">
          <div className="explore-yearstrip-track" aria-hidden="true">
            <div className="explore-yearstrip-fill" style={{ left: `${pct(state.yf)}%`, width: `${pct(state.yt) - pct(state.yf)}%` }} />
          </div>
          <input type="range" className="explore-yearstrip-range" style={{ zIndex: startOnTop ? 3 : 2 }}
            min={bounds.min} max={bounds.max} step={1} value={state.yf} disabled={flat}
            onChange={e => setState({ yf: Math.min(Number(e.target.value), state.yt) })}
            aria-label="Songs released from this year" />
          <input type="range" className="explore-yearstrip-range" style={{ zIndex: startOnTop ? 2 : 3 }}
            min={bounds.min} max={bounds.max} step={1} value={state.yt} disabled={flat}
            onChange={e => setState({ yt: Math.max(Number(e.target.value), state.yf) })}
            aria-label="Songs released up to this year" />
        </div>
      </div>

      <p className="data-filter-count">
        <strong>{kpis.songs.toLocaleString()}</strong> songs
        {' · '}{kpis.withGenre.toLocaleString()} with a genre
        {' · '}{kpis.lyric.toLocaleString()} lyric-coded
        {' · '}{kpis.audio.toLocaleString()} with sound analysis
      </p>
      <Link className="data-filter-browse" to={browseHref(state, bounds)}>Browse these songs</Link>
    </div>
  );
}

export default DataFilterBar;
