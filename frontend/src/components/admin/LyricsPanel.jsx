import { useRef, useState } from 'react';
import { AutoText, SaveTag } from './SavedField';
import { LYRIC_SITES, allSitesUrl, siteUrl, sourceNameFromUrl } from '../../utils/lyricsSearchUrls';

// songs.lyrics_source defaults to 'other' in the DB, so that counts as unset.
const sourceIsUnset = (s) => !s || String(s).trim().toLowerCase() === 'other';
const LYRIC_PARKS = ['needs_transcription', 'awaiting_community', 'listened_unclear'];

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
  const [avenuesSave, setAvenuesSave] = useState('idle');
  const [highlightsSave, setHighlightsSave] = useState('idle');
  const [holdSave, setHoldSave] = useState('idle');
  const tried = Array.isArray(wb.processing?.lyrics_tried) ? wb.processing.lyrics_tried : [];
  const park = wb.processing?.park_reason || null;
  const song = { title: wb.title, artist: (wb.artists || [])[0]?.name || '' };
  // Opening a site marks its avenue tried. Add-only: unticking stays with the Avenues checkboxes.
  const markTried = (avenue) => {
    if (!tried.includes(avenue)) saveProcessing({ lyrics_tried: [...tried, avenue] });
  };
  // Backend no-ops translation/source_url updates until a song_lyrics row exists
  // (created only when full lyrics are first saved). Gate the UI so that trap
  // is unreachable: no false "Saved" on a value that was silently dropped.
  const hasLyrics = !!(wb.lyrics && wb.lyrics.trim());
  const hasTranslation = !!(wb.translation && wb.translation.trim());
  const lyricsRef = useRef(null);
  const translationRef = useRef(null);
  // Highlights are separated in storage by a blank line; a single newline is a
  // meaningful line break within one passage (kept). Trim each passage's outer
  // whitespace only.
  const highlights = (wb.lyrics_highlights || '').split(/\n{2,}/).map((h) => h.trim()).filter(Boolean);

  const canShelve = (wb.status === 'pending' || wb.status === 'included') && !hasLyrics;
  const setHold = async (reason) => {
    setHoldSave('saving');
    // "not found" is implied by every shelving action; Clear leaves the status alone.
    // Serialised: savePanel replaces the whole workbench, so overlapping calls could clobber each other.
    if (reason) {
      const first = await savePanel('lyrics', { lyrics_status: 'not_found' });
      if (!first.ok) { setHoldSave('error'); return; }
    }
    const res = await saveProcessing({ park_reason: reason || '' });
    setHoldSave(res.ok ? 'saved' : 'error');
  };

  const onStatus = async (e) => {
    setStatusSave('saving');
    const res = await savePanel('lyrics', { lyrics_status: e.target.value });
    setStatusSave(res.ok ? 'saved' : 'error');
  };
  const toggleAvenue = async (key) => {
    const next = tried.includes(key) ? tried.filter((k) => k !== key) : [...tried, key];
    setAvenuesSave('saving');
    const res = await saveProcessing({ lyrics_tried: next });
    setAvenuesSave(res.ok ? 'saved' : 'error');
  };
  const addHighlightFrom = async (ref, sourceLabel) => {
    const el = ref.current;
    if (!el) return;
    const raw = el.value.substring(el.selectionStart, el.selectionEnd);
    // Keep the passage's own line breaks (meaningful in lyrics). Normalise CRLF,
    // strip trailing spaces, and collapse any blank line WITHIN the selection to a
    // single break — passages are separated in storage by a blank line, so an
    // internal blank line would otherwise split one passage into two.
    const sel = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n').trim();
    if (!sel) { window.alert(`Select a passage in the ${sourceLabel} box first.`); return; }
    setHighlightsSave('saving');
    const res = await savePanel('highlights', { lyrics_highlights: [...highlights, sel].join('\n\n') });
    setHighlightsSave(res.ok ? 'saved' : 'error');
  };
  const removeHighlight = async (idx) => {
    setHighlightsSave('saving');
    const res = await savePanel('highlights', { lyrics_highlights: highlights.filter((_, i) => i !== idx).join('\n\n') });
    setHighlightsSave(res.ok ? 'saved' : 'error');
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

      <div className="wb-lyric-search">
        <a className="btn btn-primary btn-sm" href={allSitesUrl(song)} target="_blank" rel="noreferrer"
          onClick={() => markTried('google')}>Search all lyric sites &#8599;</a>
        <span className="wb-field-label">or one site:</span>
        {LYRIC_SITES.map((s) => (
          <a key={s.key} className="btn btn-ghost btn-sm" href={siteUrl(s, song)} target="_blank" rel="noreferrer"
            onClick={() => markTried(s.avenue)}>{s.name}</a>
        ))}
      </div>

      <AutoText label="Full lyrics (local-only)" initial={wb.lyrics} multiline rows={12} monospace
        inputRef={lyricsRef} onSave={(v) => savePanel('lyrics', { lyrics: v })} />
      <AutoText label="Lyrics source URL" initial={wb.lyrics_source_url} placeholder="https://…"
        disabled={!hasLyrics}
        onSave={(v) => {
          const body = { source_url: v };
          const name = sourceNameFromUrl(v);
          if (name && sourceIsUnset(wb.lyrics_source)) body.lyrics_source = name;
          return savePanel('lyrics', body);
        }} />
      {!hasLyrics && <p className="admin-stub">Add full lyrics first</p>}

      <label className="wb-field">
        <span className="wb-field-label">Lyrics status <SaveTag status={statusSave} /></span>
        <select className="select" value={wb.lyrics_status || 'not_searched'} onChange={onStatus}>
          {LYRICS_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </label>

      <div className="wb-field">
        <span className="wb-field-label">Avenues tried <SaveTag status={avenuesSave} /></span>
        <div className="wb-avenues">
          {AVENUES.map(([key, label]) => (
            <label key={key} className="wb-check">
              <input type="checkbox" checked={tried.includes(key)} onChange={() => toggleAvenue(key)} /> {label}
            </label>
          ))}
        </div>
      </div>

      {(canShelve || LYRIC_PARKS.includes(park)) && (
        <div className="wb-field">
          <span className="wb-field-label">Can&rsquo;t find them? <SaveTag status={holdSave} /></span>
          <div className="wb-hold-actions">
            <button type="button" className={`btn btn-sm ${park === 'needs_transcription' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setHold('needs_transcription')}>Could transcribe by ear</button>
            <button type="button" className={`btn btn-sm ${park === 'awaiting_community' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setHold('awaiting_community')}>Put on hold &mdash; crowd-source</button>
            <button type="button" className={`btn btn-sm ${park === 'listened_unclear' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setHold('listened_unclear')}>Put on hold &mdash; can&rsquo;t make them out</button>
            {LYRIC_PARKS.includes(park) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHold(null)}>Clear</button>}
          </div>
        </div>
      )}

      <AutoText label="Translation (local-only)" initial={wb.translation} multiline rows={6}
        disabled={!hasLyrics}
        inputRef={translationRef}
        onSave={(v) => savePanel('lyrics', { translation: v })} />
      {!hasLyrics && <p className="admin-stub">Add full lyrics first</p>}

      <div className="wb-field">
        <div className="wb-highlights-head">
          <span className="wb-field-label">Key lyrics (public highlights) <SaveTag status={highlightsSave} /></span>
          <div className="wb-highlights-actions">
            <button type="button" className="btn btn-secondary btn-sm"
              onClick={() => addHighlightFrom(lyricsRef, 'lyrics')}>+ Add from lyrics</button>
            <button type="button" className="btn btn-secondary btn-sm"
              disabled={!hasLyrics || !hasTranslation}
              onClick={() => addHighlightFrom(translationRef, 'translation')}>+ Add from translation</button>
          </div>
        </div>
        {highlights.length === 0
          ? <p className="admin-stub">Select a passage in the lyrics or translation box above, then “Add from lyrics” or “Add from translation”.</p>
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
