import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import { relTime } from './relTime';

// The Inbox: pending community submissions, oldest first. A catalogue match shows a badge linking to
// the song. Accept stays available on those rows: the submit-time match is a fuzzy prefix match, so it
// can be wrong ("Free" vs "Freedom"); an exact duplicate resolves to the existing song, not a copy.
function InboxList({ refreshKey, onChanged }) {
  const [rows, setRows] = useState(null);       // null = loading
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null);     // { title, songId, added } after an accept
  const [busyId, setBusyId] = useState(null);
  const [dismissingId, setDismissingId] = useState(null);
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    adminFetch('/api/admin/curation/inbox')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('load failed')))
      .then(d => { setRows(d.rows || []); setError(''); })
      .catch(() => { setRows([]); setError('Could not load the inbox.'); });
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const act = async (row, kind) => {
    setBusyId(row.id); setError('');
    try {
      const r = await adminFetch(`/api/admin/curation/inbox/${row.id}/${kind}`, {
        method: 'POST', body: kind === 'dismiss' ? { note } : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed');
      setFlash(kind === 'accept' && d.song_id ? { title: row.song_title, songId: d.song_id, added: d.added > 0 } : null);
      setDismissingId(null); setNote('');
      onChanged();
    } catch (e) {
      setError(e.message);
      load(); // the row may already have been resolved elsewhere
    } finally { setBusyId(null); }
  };

  return (
    <div className="songs-main" style={{ flex: 1, minWidth: 0 }}>
      <div className="queue-toolbar"><h2>Inbox</h2></div>
      {error && <div className="admin-message error">{error}</div>}
      {flash && (
        <div className="admin-message success">
          {flash.added
            ? <>Added “{flash.title}” to To be processed</>
            : <>“{flash.title}” is already in the catalogue — nothing new was added</>}
          {' — '}<Link to={`/admin/song/${flash.songId}`}>open in workbench</Link>
        </div>
      )}
      {rows === null ? (
        <div className="queue-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="queue-empty">Inbox is clear.</div>
      ) : rows.map(row => (
        <div key={row.id} className="inbox-row">
          <div className="inbox-head">
            <span className="song-title">{row.song_title}</span>
            <span className="song-artist">{row.artist_name}</span>
            <span className="admin-stub">{relTime(row.created_at)}</span>
            {row.match && (
              <Link className="miss-chip warn" to={`/admin/song/${row.match.song_id}`}>
                Already in catalogue{row.match.live ? ' (live)' : ' (not live)'}
              </Link>
            )}
          </div>
          <div className="inbox-detail">
            {(row.submitter_name || row.submitter_email) && (
              <div>From {[row.submitter_name, row.submitter_email].filter(Boolean).join(' · ')}</div>
            )}
            {row.submission_reason && <div>“{row.submission_reason}”</div>}
            {row.album_name && <div>Album: {row.album_name}{row.release_year ? ` (${row.release_year})` : ''}</div>}
            {!row.album_name && row.release_year && <div>Year: {row.release_year}</div>}
            {row.youtube_url && <div><a href={row.youtube_url} target="_blank" rel="noreferrer">YouTube link</a></div>}
            {row.lyrics_excerpt && <div className="inbox-excerpt">{row.lyrics_excerpt}</div>}
          </div>
          <div className="inbox-actions">
            <button className="btn btn-primary btn-sm" disabled={busyId === row.id}
              onClick={() => act(row, 'accept')}>Add to To be processed</button>
            {dismissingId === row.id ? (
              <>
                <input className="input" placeholder="Note (optional)" value={note}
                  onChange={(e) => setNote(e.target.value)} />
                <button className="btn btn-secondary btn-sm" disabled={busyId === row.id}
                  onClick={() => act(row, 'dismiss')}>Confirm dismiss</button>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => { setDismissingId(null); setNote(''); }}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-secondary btn-sm" disabled={busyId === row.id}
                onClick={() => { setDismissingId(row.id); setNote(''); }}>Dismiss</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export default InboxList;
