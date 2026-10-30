import { useState } from 'react';
import { useBandcampLyricsRun } from './useBandcampLyricsRun';

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

// Fetches lyrics for every song of this artist that has none, from the artist's saved Bandcamp link.
function BandcampLyricsPanel({ artistId, hasBandcamp }) {
  const { start, state, save } = useBandcampLyricsRun();
  const running = state.phase === 'running';
  return (
    <section className="wb-panel">
      <h2>Lyrics from Bandcamp</h2>
      <p className="section-note">Reads the band&rsquo;s Bandcamp song pages for songs that have no lyrics yet. Nothing is saved until you press Save on a song.</p>
      <div className="bcl-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={!hasBandcamp || running} onClick={() => start('artist', artistId)}>
          Fetch lyrics from Bandcamp
        </button>
        {!hasBandcamp && <span className="section-note">Add a Bandcamp link in the Links panel first</span>}
      </div>
      <RunProgress state={state} />
      {state.phase === 'error' && <div className="admin-message error">{state.message}</div>}
      {state.phase === 'done' && (state.results.length === 0
        ? <p className="section-note">Every song by this artist already has lyrics.</p>
        : <FetchedLyricsList results={state.results} truncated={state.truncated} onSave={save} />)}
    </section>
  );
}
export default BandcampLyricsPanel;
