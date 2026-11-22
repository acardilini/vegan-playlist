import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { browseHref } from '../../../utils/dataUrlState';
import { topThemePairs, pairsTable, MIN_PAIR_N } from './flowModel';
import ChartFrame from './ChartFrame';

// "Themes that travel together": the pairs of themes that most often sit on the same song. Each row opens Browse
// filtered to both themes. Absent when no pair reaches the minimum.
function ThemePairs({ songs, labels, state, bounds }) {
  const result = useMemo(() => topThemePairs(songs, { labels }), [songs, labels]);
  if (!result.pairs.length) return null;
  const max = result.pairs[0].n;
  return (
    <ChartFrame
      title="Themes that travel together"
      table={pairsTable(result)}
      caption={`Based on ${result.n} theme-coded songs in this slice. A pair is counted once per song. Pairs with fewer than ${MIN_PAIR_N} songs are left out.`}
    >
      {() => (
        <>
          <ul className="data-arg-pairs">
            {result.pairs.map(p => (
              <li key={`${p.a}|${p.b}`}>
                <Link className="data-arg-pair" to={browseHref(state, bounds, { themes: [p.a, p.b] })}>
                  <span className="data-arg-pair-label">{p.aLabel} + {p.bLabel}</span>
                  <span className="data-arg-bar" aria-hidden="true"><span style={{ width: `${(p.n / max) * 100}%` }} /></span>
                  <span className="data-arg-pair-count">{p.n}</span>
                  <span className="data-arg-pair-share">{Math.round(p.share * 100)}%</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="data-arg-note">Browse counts songs carrying both themes anywhere on the song.</p>
        </>
      )}
    </ChartFrame>
  );
}

export default ThemePairs;
