import { useState } from 'react';
import { LYRIC_SITES, anywhereUrl, allSitesUrl, siteUrl } from '../../utils/lyricsSearchUrls';

const STATE_LABEL = { new: 'New', duplicate: 'Possible duplicate' };

// One playlist track: compact by default; "Add lyrics" opens the search links + paste box.
function CrosscheckRow({ row, choice, onChoose, lyrics, onLyrics }) {
  const [open, setOpen] = useState(false);
  const choosable = row.state !== 'have';
  const song = { title: row.title, artist: row.artists.split(', ')[0] };
  const hasLyrics = !!(lyrics && lyrics.trim());
  const toggle = (value) => onChoose(choice === value ? null : value);
  const haveLabel = row.match && (row.match.live ? 'live' : row.match.status);

  return (
    <div className="crosscheck-row">
      <div className="crosscheck-main">
        <span className="song-meta stacked">
          <span className="song-title">{row.title}</span>
          <span className="song-artist">{row.artists || '—'}{row.album ? ` · ${row.album}` : ''}</span>
          {row.state === 'duplicate' && row.match && (
            <span className="song-artist">Looks like: {row.match.title} — {row.match.artists || '—'} ({haveLabel})</span>
          )}
        </span>
        <a className="btn btn-ghost btn-sm" href={row.url} target="_blank" rel="noreferrer">Play ↗</a>
        {choosable ? (
          <>
            <span className={`crosscheck-state ${row.state}`}>{STATE_LABEL[row.state]}</span>
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              Add lyrics{hasLyrics ? ' ✓' : ''}
            </button>
            <button type="button" aria-pressed={choice === 'import'} className={`btn btn-sm ${choice === 'import' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => toggle('import')}>Import</button>
            <button type="button" aria-pressed={choice === 'reject'} className={`btn btn-sm ${choice === 'reject' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => toggle('reject')}>Reject</button>
          </>
        ) : (
          <span className={`queue-status ${haveLabel}`}>Have it · {haveLabel}</span>
        )}
      </div>
      {open && choosable && (
        <div className="crosscheck-lyrics">
          <div className="wb-lyric-search">
            <a className="btn btn-primary btn-sm" href={anywhereUrl(song)} target="_blank" rel="noreferrer">Search the web ↗</a>
            <a className="btn btn-secondary btn-sm" href={allSitesUrl(song)} target="_blank" rel="noreferrer">Listed lyric sites</a>
            {LYRIC_SITES.map((s) => (
              <a key={s.key} className="btn btn-ghost btn-sm" href={siteUrl(s, song)} target="_blank" rel="noreferrer">{s.name}</a>
            ))}
          </div>
          <textarea className="input" rows={6} value={lyrics || ''} placeholder="Paste lyrics (saved locally when you apply)"
            onChange={(e) => onLyrics(e.target.value)} />
        </div>
      )}
    </div>
  );
}
export default CrosscheckRow;
