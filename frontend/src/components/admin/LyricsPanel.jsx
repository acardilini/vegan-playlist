import { useState } from 'react';
import { AutoText, SaveTag } from './SavedField';

const LYRICS_STATUSES = ['found', 'not_found', 'not_searched'];
const AVENUES = [['google', 'Google'], ['genius', 'Genius'], ['bandcamp', 'Bandcamp'], ['youtube', 'YouTube'], ['genre_site', 'Genre sites']];

function searchLinks(title, artist) {
  const q = encodeURIComponent(`${title || ''} ${artist || ''}`.trim());
  return [
    ['Google', `https://www.google.com/search?q=${q}%20lyrics`],
    ['Genius', `https://genius.com/search?q=${q}`],
    ['Bandcamp', `https://bandcamp.com/search?q=${q}`],
    ['YouTube', `https://www.youtube.com/results?search_query=${q}`],
  ];
}

function LyricsPanel({ wb, savePanel, saveProcessing }) {
  const artist = (wb.artists || []).map((a) => a.name).join(' ');
  const [statusSave, setStatusSave] = useState('idle');
  const tried = Array.isArray(wb.processing?.lyrics_tried) ? wb.processing.lyrics_tried : [];
  // Backend no-ops translation/source_url updates until a song_lyrics row exists
  // (created only when full lyrics are first saved). Gate the UI so that trap
  // is unreachable: no false "Saved" on a value that was silently dropped.
  const hasLyrics = !!(wb.lyrics && wb.lyrics.trim());

  const onStatus = async (e) => {
    setStatusSave('saving');
    const res = await savePanel('lyrics', { lyrics_status: e.target.value });
    setStatusSave(res.ok ? 'saved' : 'error');
  };
  const toggleAvenue = (key) => {
    const next = tried.includes(key) ? tried.filter((k) => k !== key) : [...tried, key];
    saveProcessing({ lyrics_tried: next });
  };

  return (
    <section className="wb-panel">
      <h2>Lyrics</h2>

      <div className="wb-quicklinks">
        <span className="wb-field-label">Search for lyrics:</span>
        {searchLinks(wb.title, artist).map(([label, href]) => (
          <a key={label} className="btn btn-secondary btn-sm" href={href} target="_blank" rel="noreferrer">{label}</a>
        ))}
      </div>

      <AutoText label="Full lyrics (local-only)" initial={wb.lyrics} multiline rows={12} monospace
        onSave={(v) => savePanel('lyrics', { lyrics: v })} />
      <AutoText label="Lyrics source URL" initial={wb.lyrics_source_url} placeholder="https://…"
        disabled={!hasLyrics}
        onSave={(v) => savePanel('lyrics', { source_url: v })} />
      {!hasLyrics && <p className="admin-stub">Add full lyrics first</p>}

      <label className="wb-field">
        <span className="wb-field-label">Lyrics status <SaveTag status={statusSave} /></span>
        <select className="select" value={wb.lyrics_status || 'not_searched'} onChange={onStatus}>
          {LYRICS_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </label>

      <div className="wb-field">
        <span className="wb-field-label">Avenues tried</span>
        <div className="wb-avenues">
          {AVENUES.map(([key, label]) => (
            <label key={key} className="wb-check">
              <input type="checkbox" checked={tried.includes(key)} onChange={() => toggleAvenue(key)} /> {label}
            </label>
          ))}
        </div>
      </div>

      <AutoText label="Translation (local-only)" initial={wb.translation} multiline rows={6}
        disabled={!hasLyrics}
        onSave={(v) => savePanel('lyrics', { translation: v })} />
      {!hasLyrics && <p className="admin-stub">Add full lyrics first</p>}

      {/* Task 5 inserts the Highlights picker here */}
    </section>
  );
}
export default LyricsPanel;
