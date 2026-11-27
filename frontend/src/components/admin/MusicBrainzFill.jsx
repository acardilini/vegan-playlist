import { useState } from 'react';
import { api } from './bandCheckApi';
import { FACT_FIELDS, sourceKeyFor } from '../../utils/basicsModel';

const LABELS = new Map(FACT_FIELDS.map((f) => [f.key, f.label]));
const MEMBER_CHANGE = new Map([['new', 'new member'], ['status', 'status change'], ['role', 'role']]);

// The live "Fill from MusicBrainz" read (it needs the artist's stored MusicBrainz id): proposals are shown here and never
// stored; only Accept writes, one row at a time, through the existing facts routes. A role is only ever filled in where the
// stored one is empty, and the vegan mark is never touched. `fx` = useArtistFacts.
function MusicBrainzFill({ artist, fx, onNeedIdentity }) {
  const [proposals, setProposals] = useState(null); // { musicbrainz: {name}, fields: [], members: [] }
  const [filling, setFilling] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn) => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  const fill = () => run(async () => {
    setFilling(true);
    try { setProposals(await api(`${fx.base}/proposals`)); } finally { setFilling(false); }
  });
  const dropField = (field) => setProposals((p) => ({ ...p, fields: p.fields.filter((f) => f.field !== field) }));
  const dropMember = (name) => setProposals((p) => ({ ...p, members: p.members.filter((m) => m.name !== name) }));
  const acceptField = (p) => run(async () => {
    await api(fx.base, { method: 'PUT', body: { [p.field]: p.proposed, [sourceKeyFor(p.field)]: p.source } });
    dropField(p.field);
    await fx.reload();
  });
  const acceptMember = (m) => run(async () => {
    if (m.change === 'new') await api(`${fx.base}/members`, { method: 'POST', body: { name: m.name, is_current: m.is_current, source: 'MusicBrainz', ...(m.role ? { role: m.role } : {}) } });
    else await api(`${fx.base}/members/${m.existing.id}`, { method: 'PUT', body: { is_current: m.is_current, ...(m.role && !m.existing.role ? { role: m.role } : {}) } });
    dropMember(m.name);
    await fx.reload();
  });

  const nothingNew = proposals && proposals.fields.length === 0 && proposals.members.length === 0;
  return (
    <div className="aw-fill">
      {error && <div className="admin-message error">{error}</div>}
      {artist.musicbrainz_id ? (
        <button className="btn btn-secondary btn-sm" onClick={fill} disabled={filling}>{filling ? 'Reading MusicBrainz…' : 'Fill from MusicBrainz'}</button>
      ) : (
        <div className="band-meta">
          Set a MusicBrainz link under section 1 to fill facts{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => onNeedIdentity('musicbrainz')}>Open it</button>
        </div>
      )}
      {proposals && (
        <ul className="adm-list">
          <li className="adm-sub band-meta">Read MusicBrainz artist: {proposals.musicbrainz.name || 'unnamed'}</li>
          {nothingNew && <li className="adm-sub band-meta">Nothing new to add</li>}
          {proposals.fields.map((p) => (
            <li key={p.field} className="adm-row adm-wrap">
              <span className="adm-col-label">{LABELS.get(p.field) || p.field}</span>
              <span className="adm-col-name">{p.current !== null && <><s>{String(p.current)}</s>{' → '}</>}<strong>{String(p.proposed)}</strong></span>
              <span className="aw-source-actions">
                <button className="btn btn-primary btn-sm" onClick={() => acceptField(p)}>Accept</button>
                <button className="btn btn-ghost btn-sm" onClick={() => dropField(p.field)}>Skip</button>
              </span>
            </li>
          ))}
          {proposals.members.map((m) => (
            <li key={m.name} className="adm-row adm-wrap">
              <span className="adm-col-label">Member</span>
              <span className="adm-col-name"><strong>{m.name}</strong> ({MEMBER_CHANGE.get(m.change)}, {m.is_current ? 'current' : 'former'}{m.role ? `, ${m.role}` : ''})</span>
              <span className="aw-source-actions">
                <button className="btn btn-primary btn-sm" onClick={() => acceptMember(m)}>Accept</button>
                <button className="btn btn-ghost btn-sm" onClick={() => dropMember(m.name)}>Skip</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export default MusicBrainzFill;
