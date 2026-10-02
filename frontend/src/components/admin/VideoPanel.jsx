import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '../../api/adminApi';
import { SaveTag } from './SavedField';

const VIDEO_TYPES = ['official', 'live', 'lyric', 'fan-made', 'other'];

function parseYouTubeId(input) {
  const s = (input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function VideoPanel({ wb, id, reload }) {
  const [url, setUrl] = useState('');
  const [type, setType] = useState('official');
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState('idle');

  // "Find videos": candidates from the YouTube API. Cleared whenever the song changes, and a response
  // for a song the curator has already navigated away from is ignored.
  const [results, setResults] = useState(null);     // null | candidate[]
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState('');
  const [usedQuery, setUsedQuery] = useState(''); // what the API search actually used (first artist + title)
  const [ticked, setTicked] = useState({});         // { [youtube_id]: true }
  const [types, setTypes] = useState({});           // { [youtube_id]: chosen type }
  const [adding, setAdding] = useState(false);
  const idRef = useRef(id);
  useEffect(() => {
    idRef.current = id;
    setResults(null); setSearching(false); setSearchMsg(''); setUsedQuery(''); setTicked({}); setTypes({}); setAdding(false);
  }, [id]);

  const find = async () => {
    const forId = id;
    setSearching(true); setSearchMsg(''); setResults(null); setTicked({}); setTypes({});
    try {
      const r = await adminFetch(`/api/admin/workbench/${forId}/video-search`);
      const d = await r.json().catch(() => ({}));
      if (idRef.current !== forId) return;
      if (d.query) setUsedQuery(d.query);
      if (r.status === 429) setSearchMsg("Today's YouTube search quota is used up — try again tomorrow, or paste a URL below.");
      else if (!r.ok) setSearchMsg(d.message || d.error || 'Search failed');
      else if (!d.configured) setSearchMsg("YouTube search isn't configured — add YOUTUBE_API_KEY to backend/.env. You can still paste a URL below.");
      else if (!d.candidates || d.candidates.length === 0) setSearchMsg(`No results for “${d.query}” — try Search YouTube, or paste a URL below.`);
      else setResults(d.candidates);
    } catch {
      if (idRef.current === forId) setSearchMsg('Request failed');
    } finally {
      if (idRef.current === forId) setSearching(false);
    }
  };

  const toggle = (yid) => setTicked((t) => {
    const next = { ...t };
    if (next[yid]) delete next[yid]; else next[yid] = true;
    return next;
  });

  const tickedCount = (results || []).filter((c) => ticked[c.youtube_id] && !c.already_added).length;

  const addSelected = async () => {
    const forId = id;
    const picks = (results || [])
      .filter((c) => ticked[c.youtube_id] && !c.already_added)
      .map((c) => ({ youtube_id: c.youtube_id, video_title: c.title, video_type: types[c.youtube_id] || c.suggested_type }));
    if (picks.length === 0) return;
    setAdding(true); setSearchMsg(''); setStatus('saving');
    try {
      const r = await adminFetch(`/api/admin/workbench/${forId}/videos/bulk`, { method: 'POST', body: { videos: picks } });
      if (idRef.current !== forId) return;
      if (r.ok) { setResults(null); setTicked({}); setTypes({}); setStatus('saved'); reload(); }
      else {
        const d = await r.json().catch(() => ({}));
        setSearchMsg(d.error || 'Add failed');
        setStatus('error');
      }
    } catch {
      if (idRef.current === forId) { setSearchMsg('Request failed'); setStatus('error'); }
    } finally {
      if (idRef.current === forId) setAdding(false);
    }
  };

  const add = async () => {
    const yt = parseYouTubeId(url);
    if (!yt) { setMsg('Could not find an 11-char YouTube id in that URL.'); return; }
    setMsg('');
    setStatus('saving');
    try {
      const r = await adminFetch(`/api/admin/workbench/${id}/videos`, { method: 'POST', body: { youtube_id: yt, video_type: type } });
      if (r.ok) { setUrl(''); setStatus('saved'); reload(); } else {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error || 'Add failed');
        setStatus('error');
      }
    } catch { setMsg('Request failed'); setStatus('error'); }
  };
  const setPrimary = async (videoId) => {
    setMsg('');
    setStatus('saving');
    try {
      const r = await adminFetch(`/api/admin/workbench/videos/${videoId}/primary`, { method: 'PUT' });
      if (r.ok) { setStatus('saved'); reload(); } else {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error || 'Set primary failed');
        setStatus('error');
      }
    } catch { setMsg('Request failed'); setStatus('error'); }
  };
  const del = async (videoId) => {
    if (!window.confirm('Delete this video?')) return;
    setMsg('');
    setStatus('saving');
    try {
      const r = await adminFetch(`/api/admin/workbench/videos/${videoId}`, { method: 'DELETE' });
      if (r.ok) { setStatus('saved'); reload(); } else {
        const d = await r.json().catch(() => ({}));
        setMsg(d.error || 'Delete failed');
        setStatus('error');
      }
    } catch { setMsg('Request failed'); setStatus('error'); }
  };

  const videos = wb.videos || [];
  const artist = (wb.artists || []).map((a) => a.name).join(' ');
  // After a Find-videos search the fallback link reuses that exact query, so the two never disagree.
  const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(usedQuery || `${wb.title || ''} ${artist}`.trim())}`;
  return (
    <section className="wb-panel">
      <h2>Video <SaveTag status={status} /></h2>

      <div className="wb-quicklinks">
        <span className="wb-field-label">Find a video:</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={find} disabled={searching}>
          {searching ? 'Searching…' : 'Find videos'}
        </button>
        <a className="btn btn-secondary btn-sm" href={ytSearch} target="_blank" rel="noreferrer">Search YouTube</a>
      </div>

      {searchMsg && <div className="modal-result">{searchMsg}</div>}
      {results && (
        <div className="wb-vsearch">
          <ul className="wb-vsearch-list">
            {results.map((c) => (
              <li key={c.youtube_id} className={`wb-vsearch-row${c.already_added ? ' is-added' : ''}`}>
                <input type="checkbox" aria-label={`Select ${c.title}`}
                  checked={!!ticked[c.youtube_id] && !c.already_added}
                  disabled={c.already_added} onChange={() => toggle(c.youtube_id)} />
                <img className="wb-vsearch-thumb" src={c.thumbnail} alt="" loading="lazy" />
                <span className="wb-vsearch-meta">
                  <span className="wb-vsearch-title">{c.title}</span>
                  <span className="wb-vsearch-sub">
                    {c.channel}{c.duration ? ` · ${c.duration}` : ''}
                    {' · '}<a href={`https://www.youtube.com/watch?v=${c.youtube_id}`} target="_blank" rel="noreferrer">Preview</a>
                  </span>
                  {c.already_added && <span className="wb-vsearch-note">Already added</span>}
                  {c.embeddable === false && <span className="wb-vsearch-note warn">Won’t embed on the site</span>}
                </span>
                <select className="select" aria-label={`Type for ${c.title}`} disabled={c.already_added}
                  value={types[c.youtube_id] || c.suggested_type}
                  onChange={(e) => setTypes((t) => ({ ...t, [c.youtube_id]: e.target.value }))}>
                  {VIDEO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <div className="wb-vsearch-footer">
            <button type="button" className="btn btn-primary btn-sm" disabled={tickedCount === 0 || adding} onClick={addSelected}>
              {adding ? 'Adding…' : `Add ${tickedCount} selected`}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setResults(null); setTicked({}); setTypes({}); }}>Close</button>
          </div>
        </div>
      )}

      {videos.length === 0 ? <p className="admin-stub">No videos yet.</p> : (
        <ul className="wb-videos">
          {videos.map((v) => (
            <li key={v.id}>
              <label className="wb-check">
                <input type="radio" name="primary-video" checked={!!v.is_primary} onChange={() => setPrimary(v.id)} /> primary
              </label>
              <a href={`https://www.youtube.com/watch?v=${v.youtube_id}`} target="_blank" rel="noreferrer">{v.video_title || v.youtube_id}</a>
              <span className="wb-vtype">{v.video_type}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => del(v.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      <div className="wb-video-add">
        <input className="input" placeholder="YouTube URL or id" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          {VIDEO_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="button" className="btn btn-primary btn-sm" onClick={add}>Add</button>
      </div>
      {msg && <div className="modal-result">{msg}</div>}
    </section>
  );
}
export default VideoPanel;
