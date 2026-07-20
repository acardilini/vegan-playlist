import { useState } from 'react';
import { SaveTag } from './SavedField';

const PARK_REASONS = [
  ['awaiting_community', 'Awaiting community'],
  ['needs_transcription', 'Needs transcription'],
  ['listened_unclear', 'Listened — unclear'],
];
const COMPLETE_ITEMS = [
  ['lyrics', 'Lyrics'], ['cover', 'Cover'], ['video', 'Video'],
  ['play_link', 'Play link'], ['analysis', 'Analysis'],
];

function StatusBadges({ wb }) {
  const live = wb.status === 'included' && wb.published;
  return (
    <span className="wb-badges">
      <span className={`queue-status ${live ? 'live' : wb.status}`}>{live ? 'live' : wb.status}</span>
      {wb.status === 'included' && !wb.published && <span className="wb-badge-muted">unpublished</span>}
    </span>
  );
}

function Completeness({ c }) {
  return (
    <span className="wb-complete">
      {COMPLETE_ITEMS.map(([k, label]) => {
        const done = !!(c && c[k]);
        const analysisPending = k === 'analysis' && !done;
        return (
          <span key={k} className={`wb-complete-item ${done ? 'done' : 'todo'}`}>
            {label}{analysisPending ? ' pending' : ''}
          </span>
        );
      })}
    </span>
  );
}

function WorkbenchTopBar({ wb, onAction, onPark, nav }) {
  const isPending = wb.status === 'pending';
  const isIncluded = wb.status === 'included';
  const [parkSave, setParkSave] = useState('idle');

  const park = async (body) => {
    setParkSave('saving');
    const res = await onPark(body);
    setParkSave(res && res.ok ? 'saved' : 'error');
  };

  return (
    <div className="wb-decisions">
      <div className="wb-decisions-row">
        <StatusBadges wb={wb} />
        <Completeness c={wb.completeness} />
        {nav && (
          <span className="wb-nav">
            <button className="btn btn-secondary btn-sm" disabled={!nav.hasPrev} onClick={nav.onPrev}>&lsaquo; Prev</button>
            <button className="btn btn-secondary btn-sm" disabled={!nav.hasNext} onClick={nav.onNext}>Next &rsaquo;</button>
          </span>
        )}
      </div>
      <div className="wb-decisions-row">
        {isPending && <>
          <button className="btn btn-primary btn-sm" onClick={() => onAction('include')}>Include</button>
          <button className="btn btn-primary btn-sm" onClick={() => onAction('include-publish')}>Include &amp; publish</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onAction('reject')}>Reject</button>
          <select className="select" value={wb.processing?.park_reason || ''}
            onChange={(e) => park({ park_reason: e.target.value })}>
            <option value="">Not parked</option>
            {PARK_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="input" type="date" title="Remind me later"
            value={wb.processing?.snooze_until ? String(wb.processing.snooze_until).slice(0, 10) : ''}
            onChange={(e) => park({ snooze_until: e.target.value })} style={{ width: 175 }} />
          <SaveTag status={parkSave} />
        </>}
        {isIncluded && !wb.published && <button className="btn btn-primary btn-sm" onClick={() => onAction('publish')}>Publish</button>}
        {isIncluded && wb.published && <button className="btn btn-secondary btn-sm" onClick={() => onAction('unpublish')}>Unpublish</button>}
        {wb.status === 'rejected' && <button className="btn btn-primary btn-sm" onClick={() => onAction('include')}>Re-include</button>}
      </div>
    </div>
  );
}
export default WorkbenchTopBar;
