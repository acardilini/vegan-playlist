import { useCallback, useEffect, useRef, useState } from 'react';
import { AutoText, SaveTag } from './SavedField';
import { adminFetch } from '../../api/adminApi';

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

  // Prev/Next swaps `wb` without remounting — don't carry the previous song's tag over.
  useEffect(() => { setStatus('idle'); }, [wb.id]);

  // Chip edits must serialise: savePanel replaces the whole workbench object, so
  // two saves computed from the same render's list would silently lose one edit
  // (clicking a suggestion blurs the input first, firing two mutations in a row).
  const listRef = useRef(langs);
  useEffect(() => { listRef.current = Array.isArray(wb.language) ? wb.language : []; }, [wb.language]);
  const chainRef = useRef(Promise.resolve());

  const mutate = (fn) => {
    chainRef.current = chainRef.current.then(async () => {
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

function DetailsPanel({ wb, savePanel }) {
  const artistNames = (wb.artists || []).map((a) => a.name).join(', ') || '—';
  const cover = coverUrl(wb.album && wb.album.images);

  return (
    <section className="wb-panel">
      <h2>Details</h2>
      <AutoText label="Title" initial={wb.title} onSave={(v) => savePanel('details', { title: v })} />
      <LanguageChips wb={wb} savePanel={savePanel} />
      <div className="wb-readonly">
        <div><span className="k">Artist(s)</span>{artistNames}</div>
        <div><span className="k">Album</span>{(wb.album && wb.album.name) || '—'}</div>
        <div><span className="k">Released</span>{(wb.album && wb.album.release_date) || '—'}</div>
        <div><span className="k">Spotify id</span>{wb.spotify_id || '—'}</div>
      </div>
      <div className="wb-cover">
        {cover ? <img src={cover} alt="" className="wb-cover-img" /> : <span className="wb-cover-ph" />}
        <AutoText label="Cover image URL (paste)" initial={cover || ''} placeholder="https://…"
          onSave={(v) => savePanel('cover', { cover_url: v })} />
      </div>
    </section>
  );
}
export default DetailsPanel;
