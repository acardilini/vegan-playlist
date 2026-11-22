import { useCallback, useMemo } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import useDataset from '../components/explore/data/useDataset';
import DataFilterBar from '../components/explore/data/DataFilterBar';
import { yearBounds, filterSongs, computeKpis, genreRanking } from '../components/explore/data/dataModel';
import { deriveDataState, formatDataState } from '../utils/dataUrlState';

// The layout for the Data views that work on a slice of the catalogue (today: Over time). One dataset fetch, one shared
// slice (genre + years in the URL) and the slice bar; each view reads them from the outlet context. Stories do not use it:
// a story is a fixed argument over the whole catalogue, so no slice bar appears there.
function SliceLayout() {
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
    <>
      <DataFilterBar bounds={bounds} genres={genres} labels={data.labels} state={state} setState={setState} kpis={kpis} />
      <Outlet context={{ songs, allSongs, labels: data.labels, coverage: data.coverage, state, setState, bounds }} />
    </>
  );
}

export default SliceLayout;
