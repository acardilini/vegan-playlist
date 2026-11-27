import { useEffect, useState } from 'react';
import { sourceLink } from '../../utils/factSources';

const confidenceTip = (c) => (c ? `Staged evidence, ${c.toLowerCase()} confidence` : 'Staged evidence');

// A text cell that saves on blur (Enter too) only when it changed. A refused save puts the old text back; the caller shows why.
function Cell({ value, label, placeholder, className, onSave }) {
  const [val, setVal] = useState(value ?? '');
  useEffect(() => { setVal(value ?? ''); }, [value]);
  const commit = async () => {
    if (val.trim() === String(value ?? '').trim()) { setVal(value ?? ''); return; }
    const res = await onSave(val);
    if (!res.ok) setVal(value ?? '');
  };
  return (
    <input className={`input ${className}`} aria-label={label} placeholder={placeholder} value={val}
      onChange={(e) => setVal(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

// The members table: name, role, current, vegan (the curator's own tick, with the analysis's evidence only as a link),
// source, remove. Proposed changes from the staged review sit under their row; members not stored yet end the list.
// `rows` = basicsModel.memberRows(...), `fx` = useArtistFacts, `enr` = useEnrichmentReview.
function MembersTable({ artist, rows, fx, enr, onSkip }) {
  const [errors, setErrors] = useState(() => new Map());
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [addError, setAddError] = useState('');
  const setErr = (id, msg) => setErrors((m) => { const n = new Map(m); if (msg) n.set(id, msg); else n.delete(id); return n; });

  const save = async (m, patch) => {
    setErr(m.id, '');
    const res = await fx.updateMember(m.id, patch);
    if (!res.ok) setErr(m.id, res.error);
    return res;
  };
  const remove = async (m) => {
    if (!window.confirm(`Remove ${m.name} from the members?`)) return;
    const res = await fx.removeMember(m.id);
    if (!res.ok) setErr(m.id, res.error);
  };
  const add = async () => {
    if (!newName.trim()) return;
    setAddError('');
    const res = await fx.addMember({ name: newName.trim(), ...(newRole.trim() ? { role: newRole.trim() } : {}) });
    if (res.ok) { setNewName(''); setNewRole(''); } else setAddError(res.error);
  };
  const addOnEnter = (e) => { if (e.key === 'Enter') add(); };

  return (
    <div className="aw-members">
      <ul className="adm-list">
        <li className="adm-head">
          <span className="aw-m-name">Name</span><span className="aw-m-role">Role</span><span className="aw-m-cur">Current</span>
          <span className="aw-m-vegan">Vegan</span><span className="aw-m-src">Source</span><span className="aw-m-x" />
        </li>
        {rows.stored.length === 0 && rows.proposed.length === 0 && <li className="adm-row"><span className="band-meta">No members listed</span></li>}
        {rows.stored.map((m) => {
          const href = sourceLink(m.source, artist);
          const c = m.change;
          return (
            <li key={m.id} className="adm-row adm-wrap">
              <Cell className="aw-m-name" label={`Name of ${m.name}`} value={m.name} onSave={(v) => save(m, { name: v })} />
              <Cell className="aw-m-role" label={`Role of ${m.name}`} placeholder="role" value={m.role} onSave={(v) => save(m, { role: v })} />
              <span className="aw-m-cur">
                <input type="checkbox" aria-label={`${m.name} is a current member`} checked={m.is_current} onChange={(e) => save(m, { is_current: e.target.checked })} />
              </span>
              <span className="aw-m-vegan">
                <input type="checkbox" aria-label={`${m.name} is vegan`} checked={m.vegan} onChange={(e) => save(m, { vegan: e.target.checked })} />
                {m.hint && <a className="aw-hint" href={m.hint.url} target="_blank" rel="noopener noreferrer" title={confidenceTip(m.hint.confidence)}>evidence ↗</a>}
              </span>
              <span className="aw-m-src">{href ? <a href={href} target="_blank" rel="noopener noreferrer">{m.source}</a> : m.source}</span>
              <button className="adm-x aw-m-x" aria-label={`Remove ${m.name}`} onClick={() => remove(m)}>✕</button>
              {errors.has(m.id) && <div className="adm-sub enr-warn">{errors.get(m.id)}</div>}
              {c && (
                <div className="adm-sub">
                  Proposed: {c.is_current ? 'current' : 'former'} ({c.source}){' '}
                  {c.locked
                    ? <span className="band-meta">Approve the match first</span>
                    : <button className="btn btn-primary btn-sm" disabled={enr.busy} onClick={() => enr.acceptMember(c)}>Accept</button>}{' '}
                  <button className="btn btn-ghost btn-sm" onClick={() => onSkip(`member:${c.name}`)}>Skip</button>
                </div>
              )}
            </li>
          );
        })}
        {rows.proposed.map((p) => (
          <li key={`p:${p.name}`} className="adm-row adm-wrap">
            <span className="aw-m-name">{p.name}</span><span className="aw-m-role"><span className="adm-pill">proposed</span></span>
            <span className="aw-m-cur band-meta">{p.is_current ? 'current' : 'former'}</span><span className="aw-m-vegan" />
            <span className="aw-m-src">{p.source}</span>
            <span className="aw-m-x" />
            <div className="adm-sub">
              {p.locked
                ? <span className="band-meta">Approve the match first</span>
                : <button className="btn btn-primary btn-sm" disabled={enr.busy} onClick={() => enr.acceptMember(p)}>Accept</button>}{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => onSkip(`member:${p.name}`)}>Skip</button>
            </div>
          </li>
        ))}
        <li className="adm-row adm-wrap">
          <input className="input aw-m-name" aria-label="Add member" placeholder="Add member" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={addOnEnter} />
          <input className="input aw-m-role" aria-label="Role of the new member" placeholder="role" value={newRole} onChange={(e) => setNewRole(e.target.value)} onKeyDown={addOnEnter} />
          <button className="btn btn-secondary btn-sm" disabled={!newName.trim()} onClick={add}>Add</button>
          {addError && <div className="adm-sub enr-warn">{addError}</div>}
        </li>
      </ul>
    </div>
  );
}
export default MembersTable;
