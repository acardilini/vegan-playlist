import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import WorkbenchTopBar from './WorkbenchTopBar';
import DetailsPanel from './DetailsPanel';
import LyricsPanel from './LyricsPanel';
import VideoPanel from './VideoPanel';
import LinksPanel from './LinksPanel';
import AnalysisPanel from './AnalysisPanel';
import NotesPanel from './NotesPanel';

function Workbench() {
  const { id } = useParams();
  const [wb, setWb] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const reload = useCallback(() => {
    adminFetch(`/api/admin/workbench/${id}`)
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d) => { if (d) { setWb(d); setNotFound(false); } })
      .catch(() => {});
  }, [id]);

  useEffect(() => { setWb(null); setNotFound(false); reload(); }, [reload]);

  const savePanel = useCallback(async (panel, body) => {
    try {
      const r = await adminFetch(`/api/admin/workbench/${id}/${panel}`, { method: 'PUT', body });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.workbench) { setWb(d.workbench); return { ok: true }; }
      return { ok: false, error: d.error || 'Save failed' };
    } catch { return { ok: false, error: 'Request failed' }; }
  }, [id]);

  const saveProcessing = useCallback(async (body) => {
    try {
      const r = await adminFetch(`/api/admin/workbench/${id}/processing`, { method: 'PUT', body });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.processing) { setWb((w) => (w ? { ...w, processing: d.processing } : w)); return { ok: true }; }
      return { ok: false, error: d.error || 'Save failed' };
    } catch { return { ok: false, error: 'Request failed' }; }
  }, [id]);

  const doAction = useCallback(async (kind) => {
    if (kind === 'reject' && !window.confirm('Reject this song? It stays recoverable, but this clears the include decision.')) return;
    const map = {
      'include': ['include', { publish: false }],
      'include-publish': ['include', { publish: true }],
      'reject': ['reject', undefined],
      'publish': ['publish', undefined],
      'unpublish': ['unpublish', undefined],
    };
    const [path, body] = map[kind];
    try {
      const r = await adminFetch(`/api/admin/songs/${id}/${path}`, { method: 'POST', body });
      if (!r.ok) { const d = await r.json().catch(() => ({})); window.alert(d.error || 'Action failed'); return; }
      reload();
    } catch { window.alert('Request failed'); }
  }, [id, reload]);

  if (notFound) {
    return (
      <div>
        <Link to="/admin/songs" className="btn btn-ghost btn-sm">&larr; Back to Songs</Link>
        <h1>Song not found</h1>
        <p className="admin-stub">No song with id {id}.</p>
      </div>
    );
  }
  if (!wb) return <div className="queue-empty">Loading…</div>;

  const artistNames = (wb.artists || []).map((a) => a.name).join(', ') || '—';

  return (
    <div className="workbench">
      <div className="wb-topbar">
        <Link to="/admin/songs" className="btn btn-ghost btn-sm">&larr; Back to Songs</Link>
        <h1 className="wb-title">{wb.title || `Song ${wb.id}`}</h1>
        <div className="wb-artist">{artistNames}</div>
        <WorkbenchTopBar wb={wb} onAction={doAction} onPark={saveProcessing} nav={null} />
      </div>
      <div className="wb-grid">
        <div className="wb-col wb-col-main">
          <LyricsPanel wb={wb} savePanel={savePanel} saveProcessing={saveProcessing} />
        </div>
        <div className="wb-col wb-col-side">
          <DetailsPanel wb={wb} savePanel={savePanel} />
          <VideoPanel wb={wb} id={id} reload={reload} />
          <LinksPanel wb={wb} savePanel={savePanel} id={id} reload={reload} />
          <AnalysisPanel wb={wb} />
          <NotesPanel wb={wb} savePanel={savePanel} saveProcessing={saveProcessing} />
        </div>
      </div>
    </div>
  );
}
export default Workbench;
