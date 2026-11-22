import { Link } from 'react-router-dom';
import { browseHref } from '../../../utils/dataUrlState';
import { browseSelectionFor } from './flowModel';
import { noun, resolvePin } from './flowPin';

// The pinned selection: its count and share (computed), and a Browse link. A selection that includes the folded Other
// node has no link, since Browse could not express "everything else".
function FlowDetail({ flow, pin, state, bounds, onClear }) {
  const sel = resolvePin(flow, pin);
  if (!sel) return null;
  const pct = Math.round((sel.n / flow.n) * 100);
  const hasOther = sel.parts.some(p => p.other);
  return (
    <div className="data-arg-detail" aria-live="polite">
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
        <p className="data-arg-note">Browse counts songs with this code anywhere, not only as the first-listed one.</p>
      )}
    </div>
  );
}

export default FlowDetail;
