import { useCallback, useEffect, useRef, useState } from 'react';
import { AutoText, SaveTag } from './SavedField';
import { adminFetch } from '../../api/adminApi';
import SpotifyFill from './SpotifyFill';

function coverUrl(images) {
  if (!images) return null;
  let arr = images;
  if (typeof images === 'string') { try { arr = JSON.parse(images); } catch { return null; } }
  return Array.isArray(arr) && arr[0] && arr[0].url ? arr[0].url : null;
}

// Multi-value language editor. songs.language is text[] since migration 009.
// Every mutation saves immediately and reports through SaveTag (the A3 standard:
// no fire-and-forget saves).
function LanguageChips({ wb, savePanel }) {
  const langs = Array.isArray(wb.language) ? wb.language : [];
  const [status, setStatus] = useState('idle');
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  const loadSuggestions = useCallback(() => {
    adminFetch('/api/admin/languages')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.languages)) setSuggestions(d.languages.map((l) => l.value)); })
      // Suggestions are a convenience only; a failed fetch must not disrupt curation.
      .catch(() => {});
  }, []);
  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  // Chip edits must serialise: savePanel replaces the whole workbench object, so
  // two saves computed from the same render's list would silently lose one edit
  // (clicking a suggestion blurs the input first, firing two mutations in a row).
  const listRef = useRef(langs);
  // Our own saves are the authority on this list while they are in flight. An
  // unrelated wb replacement (another panel's save, or a top-bar action's
  // reload()) can carry a snapshot older than the edit we just queued, so
  // resync only when nothing of ours is outstanding.
  // (A narrower window remains: a reload() GET whose snapshot predates a language
  // save that has already completed. That's the same whole-object-replace
  // limitation every other workbench field shares — not worth version tracking.)
  const pendingRef = useRef(0);
  useEffect(() => {
    if (pendingRef.current === 0) listRef.current = Array.isArray(wb.language) ? wb.language : [];
  }, [wb.language]);
  const chainRef = useRef(Promise.resolve());

  const mutate = (fn) => {
    pendingRef.current += 1;
    chainRef.current = chainRef.current.then(async () => {
      try {
        const before = listRef.current;
        const next = fn(before);
        if (next === before) return;              // no-op (blank or duplicate)
        listRef.current = next;                   // a queued follow-up builds on this
        setStatus('saving');
        const res = await savePanel('details', { language: next });
        if (res && res.ok) {
          setStatus('saved');
          loadSuggestions();                      // a newly typed language becomes a suggestion
        } else {
          listRef.current = before;               // server rejected it — undo the optimistic list
          setStatus('error');
        }
      } finally {
        pendingRef.current -= 1;
      }
    });
  };

  const has = (list, v) => list.some((l) => l.toLowerCase() === v.toLowerCase());
  const add = (value) => {
    const v = (value || '').trim();
    setDraft('');
    if (!v) return;
    mutate((list) => (has(list, v) ? list : [...list, v]));
  };
  const remove = (value) => mutate((list) => list.filter((l) => l !== value));

  const unused = suggestions.filter((s) => !has(langs, s)).slice(0, 6);

  return (
    <div className="wb-field wb-lang">
      <span className="wb-field-label">Language sung in <SaveTag status={status} /></span>
      <div className="wb-lang-chips">
        {langs.length === 0
          ? <span className="admin-stub">None recorded</span>
          : langs.map((l, idx) => (
              <span key={`${l}-${idx}`} className="wb-lang-chip">{l}
                <button type="button" className="wb-lang-x" aria-label={`Remove ${l}`}
                  onClick={() => remove(l)}>×</button>
              </span>
            ))}
      </div>
      <input className="input" value={draft} placeholder="Add a language, then press Enter"
        aria-label="Add a language"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
        onBlur={() => add(draft)} />
      {unused.length > 0 && (
        <div className="wb-lang-suggest">
          {unused.map((s) => (
            <button key={s} type="button" className="btn btn-secondary btn-sm"
              onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// The song's own genre, with where the effective genre comes from. A song with no genre of its own still
// shows under its first artist's genre on the public site; the line below says so. Saves on Enter/blur.
function GenreField({ wb, savePanel }) {
  const [value, setValue] = useState(wb.genre || '');
  const [status, setStatus] = useState('idle');
  const [options, setOptions] = useState([]);
  useEffect(() => { setValue(wb.genre || ''); }, [wb.genre]);
  useEffect(() => {
    adminFetch('/api/admin/categorization-options')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setOptions([...new Set([...(d.parent_genres || []), ...(d.subgenres || [])])].sort()); })
      // The list is a convenience only; a failed fetch leaves a free-text field.
      .catch(() => {});
  }, []);

  const save = async (next) => {
    const v = next.trim().toLowerCase();
    if (v === (wb.genre || '')) return;
    setStatus('saving');
    const res = await savePanel('details', { genre: v });
    setStatus(res && res.ok ? 'saved' : 'error');
  };
  const ag = wb.artist_genre;
  let source;
  if (wb.genre) source = 'Set on this song';
  else if (ag) source = `Not set on the song - the site uses the artist's genre (${ag.value}, from ${ag.artist})`;
  else source = 'No genre on the song or its artist';

  return (
    <div className="wb-field">
      <span className="wb-field-label">Genre <SaveTag status={status} /></span>
      <input className="input" list="wb-genre-options" value={value} aria-label="Genre"
        placeholder="Pick or type a genre, then press Enter"
        onChange={(e) => { setValue(e.target.value); if (status !== 'idle') setStatus('idle'); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(value); } }}
        onBlur={() => save(value)} />
      <datalist id="wb-genre-options">{options.map((o) => <option key={o} value={o} />)}</datalist>
      <div className="wb-genre-source">
        {source}
        {!wb.genre && ag && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setValue(ag.value); save(ag.value); }}>
            Use {ag.value} for this song
          </button>
        )}
        {wb.genre && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setValue(''); save(''); }}>Clear</button>
        )}
      </div>
    </div>
  );
}

function DetailsPanel({ wb, savePanel }) {
  const artistNames = (wb.artists || []).map((a) => a.name).join(', ') || '—';
  const cover = coverUrl(wb.album && wb.album.images);
  // Spotify owns its albums; only a manual album, or no album yet, can be edited here.
  const albumEditable = !wb.album || !wb.album.source || wb.album.source === 'manual';

  return (
    <section className="wb-panel">
      <h2>Details</h2>
      <AutoText label="Title" initial={wb.title} onSave={(v) => savePanel('details', { title: v })} />
      <GenreField wb={wb} savePanel={savePanel} />
      <LanguageChips wb={wb} savePanel={savePanel} />
      <div className="wb-readonly">
        <div><span className="k">Artist(s)</span>{artistNames}</div>
        {!albumEditable && <div><span className="k">Album</span>{(wb.album && wb.album.name) || '—'}</div>}
        {!albumEditable && <div><span className="k">Released</span>{(wb.album && wb.album.release_date) || '—'}</div>}
        <div><span className="k">Spotify id</span>{wb.spotify_id || '—'}</div>
      </div>
      {wb.spotify_url && <SpotifyFill key={wb.id} wb={wb} savePanel={savePanel} />}
      {albumEditable && (
        <>
          <AutoText label="Album" initial={(wb.album && wb.album.name) || ''}
            placeholder="Album, or the single's name"
            onSave={(v) => savePanel('album', { name: v })} />
          <AutoText label="Released" initial={(wb.album && wb.album.release_date) || ''}
            placeholder="YYYY-MM-DD"
            onSave={(v) => savePanel('album', { release_date: v })} />
        </>
      )}
      <div className="wb-cover">
        {cover ? <img src={cover} alt="" className="wb-cover-img" /> : <span className="wb-cover-ph" />}
        <AutoText label="Cover image URL (paste)" initial={cover || ''} placeholder="https://…"
          onSave={(v) => savePanel('cover', { cover_url: v })} />
      </div>
    </section>
  );
}
export default DetailsPanel;
