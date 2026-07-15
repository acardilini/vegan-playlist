import { useRef, useState } from 'react';
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
  const lyricsRef = useRef(null);
  const highlights = (wb.lyrics_highlights || '').split('\n').map((h) => h.trim()).filter(Boolean);

  const onStatus = async (e) => {
    setStatusSave('saving');
    const res = await savePanel('lyrics', { lyrics_status: e.target.value });
    setStatusSave(res.ok ? 'saved' : 'error');
  };
  const toggleAvenue = (key) => {
    const next = tried.includes(key) ? tried.filter((k) => k !== key) : [...tried, key];
    saveProcessing({ lyrics_tried: next });
  };
  const addHighlight = () => {
    const el = lyricsRef.current;
    if (!el) return;
    const raw = el.value.substring(el.selectionStart, el.selectionEnd).trim();
    // Collapse internal newlines/whitespace to a single space so a multi-line
    // passage (e.g. a couplet) stays one entry in the newline-joined storage —
    // otherwise it would fragment on the next `split('\n')` read.
    const sel = raw.replace(/\s*\n\s*/g, ' ');
    if (!sel) { window.alert('Select a passage in the lyrics box first.'); return; }
    savePanel('highlights', { lyrics_highlights: [...highlights, sel].join('\n') });
  };
  const removeHighlight = (idx) => {
    savePanel('highlights', { lyrics_highlights: highlights.filter((_, i) => i !== idx).join('\n') });
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
        inputRef={lyricsRef} onSave={(v) => savePanel('lyrics', { lyrics: v })} />
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

      <div className="wb-field">
        <div className="wb-highlights-head">
          <span className="wb-field-label">Key lyrics (public highlights)</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addHighlight}>+ Add selection</button>
        </div>
        {highlights.length === 0
          ? <p className="admin-stub">Select a line in the lyrics box above, then “Add selection”.</p>
          : <ul className="wb-highlights">
              {highlights.map((h, idx) => (
                <li key={idx}><span>{h}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeHighlight(idx)}>Remove</button>
                </li>
              ))}
            </ul>}
      </div>
    </section>
  );
}
export default LyricsPanel;
