import { useCallback, useMemo } from 'react';
import { NavLink, Outlet, useSearchParams } from 'react-router-dom';
import useDataset from '../components/explore/data/useDataset';
import DataFilterBar from '../components/explore/data/DataFilterBar';
import { yearBounds, filterSongs, computeKpis, genreRanking } from '../components/explore/data/dataModel';
import { deriveDataState, formatDataState } from '../utils/dataUrlState';

// A tab appears here only once it is built. With a single tab there is nothing to switch between, so the row is hidden.
const TABS = [{ to: 'over-time', label: 'Over time' }];

// Explore > Data: one dataset fetch, one shared slice (genre + years in the URL) and a route per view. Each tab reads the
// slice and the whole catalogue from the outlet context and does its own charts.
function DataPage() {
  const { status, data } = useDataset();
  const [params, setParams] = useSearchParams();
  const allSongs = useMemo(() => (data ? data.songs : []), [data]);
  const bounds = useMemo(() => yearBounds(allSongs), [allSongs]);
  const state = useMemo(() => deriveDataState(params, bounds), [params, bounds]);
  const setState = useCallback(
    patch => setParams(prev => formatDataState({ ...deriveDataState(prev, bounds), ...patch }, bounds, prev), { replace: true }),
    [bounds, setParams],
  );
  const songs = useMemo(() => filterSongs(allSongs, state, bounds), [allSongs, state, bounds]);
  const kpis = useMemo(() => computeKpis(songs), [songs]);
  const genres = useMemo(() => genreRanking(allSongs), [allSongs]);

  if (status === 'loading') return <p className="data-status" role="status">Loading the catalogue&hellip;</p>;
  if (status === 'error' || !bounds) return <p className="data-status" role="alert">The data could not be loaded. Please try again in a moment.</p>;

  return (
    <div className="data-page">
      {TABS.length > 1 && (
        <nav className="data-tabs" aria-label="Data views">
          {TABS.map(t => (
            <NavLink key={t.to} to={{ pathname: t.to, search: params.toString() }} className={({ isActive }) => `data-tab-link ${isActive ? 'active' : ''}`}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
      <DataFilterBar bounds={bounds} genres={genres} labels={data.labels} state={state} setState={setState} kpis={kpis} />
      <Outlet context={{ songs, allSongs, labels: data.labels, coverage: data.coverage, state, setState, bounds }} />
    </div>
  );
}

export default DataPage;
