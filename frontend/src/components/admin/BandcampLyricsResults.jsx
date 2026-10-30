import { useState } from 'react';

// One row per song in a finished run. Found lyrics are shown for review; nothing is saved until Save is pressed.
function ResultRow({ result, onSave }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const found = result.status === 'found' && !result.saved;
  const press = async () => {
    setBusy(true); setMessage('');
    const res = await onSave(result.songId);
    if (!res.ok) setMessage(res.message || 'Could not save.');
    setBusy(false);
  };
  return (
    <li className="bcl-row">
      <div className="bcl-row-head">
        <span className="bcl-title">{result.title}</span>
        {result.saved && <span className="miss-chip">Saved</span>}
        {!result.saved && !found && <span className="section-note">{result.note}</span>}
        {found && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={press}>Save lyrics</button>}
      </div>
      {found && <pre className="bcl-lyrics" tabIndex={0}>{result.lyrics}</pre>}
      {message && <span className="modal-result">{message}</span>}
    </li>
  );
}

export function FetchedLyricsList({ results, truncated, onSave }) {
  const foundCount = results.filter((r) => r.status === 'found' || r.saved).length;
  return (
    <>
      <p className="section-note">
        {foundCount} of {results.length} songs have lyrics on Bandcamp. Review each one, then save it.
        {truncated ? ' The band has more than 40 releases, so the catalogue was cut short.' : ''}
      </p>
      <ul className="bcl-list">
        {results.map((r) => <ResultRow key={r.songId} result={r} onSave={onSave} />)}
      </ul>
    </>
  );
}

export function RunProgress({ state }) {
  if (state.phase !== 'running') return null;
  return (
    <div className="bcl-progress" role="status">
      {state.total > 0
        ? <><progress max={state.total} value={state.done} /> <span>Reading {state.done} of {state.total} songs</span></>
        : <span>Reading the Bandcamp catalogue&hellip;</span>}
    </div>
  );
}
