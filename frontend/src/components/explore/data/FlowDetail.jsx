import { Link } from 'react-router-dom';
import { browseHref } from '../../../utils/dataUrlState';
import { browseSelectionFor } from './flowModel';
import { noun, resolvePin } from './flowPin';

// The pinned selection: its count and share (computed), and a Browse link. A selection that includes the folded Other
// node has no link, since Browse could not express "everything else".
function FlowDetail({ flow, pin, state, bounds, onClear }) {
  const sel = resolvePin(flow, pin);
  // the live region stays mounted (empty when nothing is pinned) so a screen reader announces a newly pinned selection
  if (!sel) return <div className="data-arg-live" aria-live="polite" />;
  const pct = Math.round((sel.n / flow.n) * 100);
  const hasOther = sel.parts.some(p => p.other);
  // a genre pick: the flow's genre includes audio-inferred genres, but Browse matches catalogue genres only
  const touchesGenre = sel.parts.some(p => flow.preset.columns[p.col].field === 'g');
  return (
    <div className="data-arg-live" aria-live="polite">
      <div className="data-arg-detail">
        <p className="data-arg-detail-line">
          <strong>{sel.label}</strong>
          {`: ${sel.n} ${noun(sel.n)}, ${pct}% of the pathway songs.`}
          {!hasOther && (
            <>
              {' '}
              <Link to={browseHref(state, bounds, browseSelectionFor(flow.preset, sel.parts))}>Browse songs</Link>
            </>
          )}
          {' '}
          <button type="button" className="data-arg-clear" onClick={onClear}>Clear</button>
        </p>
        {!hasOther && (
          <p className="data-arg-note">Browse counts songs with this code anywhere, not only as the first-listed one.
            {touchesGenre && ' Browse matches catalogue genres only, so it can list fewer songs than the flow counts.'}
          </p>
        )}
      </div>
    </div>
  );
}

export default FlowDetail;
