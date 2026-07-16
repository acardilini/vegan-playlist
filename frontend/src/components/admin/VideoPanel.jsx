import { useState } from 'react';
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
  const ytSearch = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${wb.title || ''} ${artist}`.trim())}`;
  return (
    <section className="wb-panel">
      <h2>Video <SaveTag status={status} /></h2>

      <div className="wb-quicklinks">
        <span className="wb-field-label">Find a video:</span>
        <a className="btn btn-secondary btn-sm" href={ytSearch} target="_blank" rel="noreferrer">Search YouTube</a>
      </div>

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
