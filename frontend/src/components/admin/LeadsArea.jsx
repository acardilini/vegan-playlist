import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from './bandCheckApi';

const FILTERS = [['new', 'To look into'], ['checked', 'Checked'], ['dismissed', 'Dismissed']];
const STATUS_TEXT = { new: 'To look into', checked: 'Checked', dismissed: 'Dismissed' };
const EMPTY = { new: 'Nothing to look into. Capture a band above.', checked: 'No checked leads yet.', dismissed: 'No dismissed leads.' };
const changed = () => window.dispatchEvent(new Event('leads-changed')); // the menu count and Dashboard refresh from this
const day = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');
const isHttp = (u) => /^https?:\/\//i.test(u || '');

// Leads: capture a band by name in seconds, look at them later, promote one into an artist workbench.
function LeadsArea() {
  const navigate = useNavigate();
  const nameRef = useRef(null);
  const [status, setStatus] = useState('new');
  const [data, setData] = useState({ leads: [], counts: { new: 0, checked: 0, dismissed: 0 } });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [song, setSong] = useState('');
  const [url, setUrl] = useState('');
  const [more, setMore] = useState(false);
  const [dup, setDup] = useState(null); // the result of an add that matched an existing lead or artist
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busy, setBusy] = useState(false); // one capture at a time: a second Enter while the first is in flight must not send another
  const drafts = useRef(new Map());       // note text being edited per lead, so Promote can save it first

  const load = useCallback(() => api(`/api/admin/leads?status=${status}`)
    .then((d) => { setData(d); setLoaded(true); setError(''); })
    .catch((e) => setError(e.message)), [status]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };

  const add = () => run(async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api('/api/admin/leads', { method: 'POST', body: { name, note, song: more ? song : '', url: more ? url : '' } });
      if (r.status === 'duplicate') { setDup(r); return; }
      setDup(null); setName(''); setNote(''); setSong(''); setUrl('');
      changed(); await load();
      if (nameRef.current) nameRef.current.focus();
    } finally { setBusy(false); }
  });
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };

  const update = (lead, patch) => run(async () => { await api(`/api/admin/leads/${lead.id}`, { method: 'PUT', body: patch }); changed(); await load(); });
  const restoreDup = () => run(async () => { await api(`/api/admin/leads/${dup.lead.id}`, { method: 'PUT', body: { status: 'new' } }); setDup(null); setName(''); changed(); await load(); });
  const promote = (lead) => run(async () => {
    const draft = drafts.current.get(lead.id); // an edit still in the note box (its blur save may not have landed) goes first
    if (draft !== undefined && draft.trim() !== (lead.note || '')) await api(`/api/admin/leads/${lead.id}`, { method: 'PUT', body: { note: draft } });
    const r = await api(`/api/admin/leads/${lead.id}/promote`, { method: 'POST', body: {} }); changed(); navigate(`/admin/artist/${r.artistId}`); });
  const remove = (lead) => {
    if (confirmDelete !== lead.id) { setConfirmDelete(lead.id); return; }
    setConfirmDelete(null);
    run(async () => { await api(`/api/admin/leads/${lead.id}`, { method: 'DELETE' }); changed(); await load(); });
  };

  const dupMessage = () => {
    if (!dup) return null;
    if (dup.kind === 'artist') return <>Already an artist: <Link to={`/admin/artist/${dup.artist.id}`}>{dup.artist.name}</Link></>;
    const s = dup.lead.status;
    if (s === 'dismissed') return <>Already a lead, dismissed on {day(dup.lead.dismissed_at)} <button className="btn btn-ghost btn-sm" onClick={restoreDup}>Restore</button></>;
    if (s === 'checked') return <>Already a lead (Checked) <button className="btn btn-ghost btn-sm" onClick={restoreDup}>Restore</button></>;
    return <>Already a lead ({STATUS_TEXT[s]})</>;
  };

  return (
    <div className="leads-area">
      <h1>Leads</h1>
      <div className="leads-capture">
        <div className="leads-capture-row">
          <input ref={nameRef} className="input" autoFocus aria-label="Band name" placeholder="Band name, then Enter" value={name}
            onChange={(e) => { setName(e.target.value); if (dup) setDup(null); }} onKeyDown={onKey} />
          <input className="input" aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onKey} />
          <button className="btn btn-primary btn-sm" onClick={add} disabled={!name.trim() || busy}>Add</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setMore((m) => !m)} aria-expanded={more}>{more ? 'Less' : 'More'}</button>
        </div>
        {more && (
          <div className="leads-capture-row">
            <input className="input" aria-label="Song" placeholder="Song (optional)" value={song} onChange={(e) => setSong(e.target.value)} onKeyDown={onKey} />
            <input className="input" aria-label="Link" placeholder="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onKey} />
          </div>
        )}
        {dup && <div className="admin-message">{dupMessage()}</div>}
      </div>
      {error && <div className="admin-message error">{error}</div>}

      <div className="leads-filters" role="group" aria-label="Lead status">
        {FILTERS.map(([key, label]) => (
          <button key={key} className={`btn btn-sm ${status === key ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={status === key} onClick={() => setStatus(key)}>
            {label} ({data.counts[key]})
          </button>
        ))}
      </div>

      {loaded && data.leads.length === 0 && <div className="queue-empty">{EMPTY[status]}</div>}
      {data.leads.map((l) => (
        <div key={l.id} className="inbox-row lead-row">
          <div>
            <strong>{l.name}</strong>
            {l.artist_match && <> <Link className="band-chip" to={`/admin/artist/${l.artist_match.id}`}>already an artist</Link></>}
            <span className="band-meta"> · added {day(l.created_at)}</span>
          </div>
          <div className="band-meta">
            {l.song && <>Song: {l.song} · </>}
            {l.url && (isHttp(l.url) ? <a href={l.url} target="_blank" rel="noopener noreferrer">{l.url}</a> : l.url)}
          </div>
          <NoteField lead={l} drafts={drafts} onSave={(v) => update(l, { note: v })} />
          <div className="lead-actions">
            {l.status === 'new' && <button className="btn btn-primary btn-sm" onClick={() => promote(l)}>Promote</button>}
            {l.status === 'new' && <button className="btn btn-secondary btn-sm" onClick={() => update(l, { status: 'checked' })}>Mark checked</button>}
            {l.status === 'new' && <button className="btn btn-ghost btn-sm" onClick={() => update(l, { status: 'dismissed' })}>Dismiss</button>}
            {l.status !== 'new' && <button className="btn btn-secondary btn-sm" onClick={() => update(l, { status: 'new' })}>Restore</button>}
            {l.artist_id && <Link className="btn btn-ghost btn-sm" to={`/admin/artist/${l.artist_id}`}>Open artist</Link>}
            <button className="btn btn-ghost btn-sm" onClick={() => remove(l)} onBlur={() => setConfirmDelete(null)}>{confirmDelete === l.id ? 'Confirm delete' : 'Delete'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Inline note edit: saves on blur when changed.
function NoteField({ lead, drafts, onSave }) {
  const [val, setVal] = useState(lead.note || '');
  useEffect(() => { setVal(lead.note || ''); drafts.current.delete(lead.id); }, [lead.note, lead.id, drafts]);
  return (
    <input className="input lead-note" aria-label={`Note for ${lead.name}`} placeholder="Add a note" value={val}
      onChange={(e) => { setVal(e.target.value); drafts.current.set(lead.id, e.target.value); }} onBlur={() => { if (val.trim() !== (lead.note || '')) onSave(val); }} />
  );
}

export default LeadsArea;
