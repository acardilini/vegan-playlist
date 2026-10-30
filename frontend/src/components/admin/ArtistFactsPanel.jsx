import { useCallback, useEffect, useState } from 'react';
import { api } from './bandCheckApi';
import { AutoText } from './SavedField';

const FIELDS = [
  { key: 'country', label: 'Country', year: false },
  { key: 'formed_year', label: 'Formed (year)', year: true },
  { key: 'disbanded_year', label: 'Disbanded (year)', year: true },
  { key: 'last_release_year', label: 'Last release (year)', year: true },
];
const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
const sourceKey = (key) => (key === 'country' ? 'country_source' : `${key.replace('_year', '')}_source`);
const MEMBER_CHANGE = { new: 'new member', status: 'status change' };

// Facts panel for the artist workbench: stored facts (each with its source), members with the curator-only vegan mark,
// and "Fill from MusicBrainz" proposals the curator accepts one at a time. Proposals are never stored; only Accept writes.
function ArtistFactsPanel({ artist, onNeedIdentity }) {
  const base = `/api/admin/artists/${artist.id}/facts`;
  const [facts, setFacts] = useState(null);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState(null); // { musicbrainz: {name}, fields: [], members: [] }
  const [filling, setFilling] = useState(false);
  const [newMember, setNewMember] = useState('');

  const load = useCallback(() => api(base).then((d) => { setFacts(d); setError(''); }).catch((e) => setError(e.message)), [base]);
  useEffect(() => { setFacts(null); setProposals(null); load(); }, [load]);

  const run = async (fn) => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  const put = (patch) => api(base, { method: 'PUT', body: patch }).then((d) => { setFacts(d); return d; });

  const saveField = (f) => async (v) => {
    const text = v.trim();
    const value = text === '' ? null : f.year && /^\d+$/.test(text) ? Number(text) : text;
    try { await put({ [f.key]: value }); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  };

  const fill = () => run(async () => {
    setFilling(true);
    try { setProposals(await api(`${base}/proposals`)); } finally { setFilling(false); }
  });
  const dropField = (field) => setProposals((p) => ({ ...p, fields: p.fields.filter((f) => f.field !== field) }));
  const dropMember = (name) => setProposals((p) => ({ ...p, members: p.members.filter((m) => m.name !== name) }));
  const acceptField = (p) => run(async () => { await put({ [p.field]: p.proposed, [sourceKey(p.field)]: p.source }); dropField(p.field); });
  const acceptMember = (m) => run(async () => {
    if (m.change === 'new') await api(`${base}/members`, { method: 'POST', body: { name: m.name, is_current: m.is_current, source: 'MusicBrainz' } });
    else await api(`${base}/members/${m.existing.id}`, { method: 'PUT', body: { is_current: m.is_current } }); // never touches the vegan mark
    dropMember(m.name);
    await load();
  });

  const setOverride = (value) => run(() => put({ active_override: value }));
  const updateMember = (m, patch) => run(async () => { await api(`${base}/members/${m.id}`, { method: 'PUT', body: patch }); await load(); });
  const removeMember = (m) => run(async () => { await api(`${base}/members/${m.id}`, { method: 'DELETE' }); await load(); });
  const addMember = () => run(async () => {
    if (!newMember.trim()) return;
    await api(`${base}/members`, { method: 'POST', body: { name: newMember.trim() } });
    setNewMember('');
    await load();
  });

  const override = facts ? facts.active_override : null;
  const nothingNew = proposals && proposals.fields.length === 0 && proposals.members.length === 0;

  return (
    <section className="wb-panel">
      <h2>Facts</h2>
      {error && <div className="admin-message error">{error}</div>}
      {!facts ? <div className="queue-empty">Loading…</div> : (
        <>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <AutoText label={f.label} initial={f.year ? String(facts[f.key] ?? '') : (facts[f.key] ?? '')} onSave={saveField(f)} />
              {facts[sourceKey(f.key)] && <div className="band-meta fact-source">{facts[sourceKey(f.key)]}</div>}
            </div>
          ))}

          <div className="wb-field">
            <span className="wb-field-label">Active</span>
            <div className="fact-active">
              <span>{facts.active.label || 'Not known yet'}</span>
              <span className="fact-seg" role="group" aria-label="Active status">
                {[['Automatic', null], ['Active', true], ['Not active', false]].map(([text, value]) => (
                  <button key={text} className={`btn btn-sm ${override === value ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={override === value} onClick={() => setOverride(value)}>{text}</button>
                ))}
              </span>
            </div>
          </div>

          <div className="wb-field">
            <span className="wb-field-label">Members</span>
            {facts.members.length === 0 && <div className="band-meta">No members listed</div>}
            {facts.members.map((m) => (
              <div key={m.id} className="fact-member">
                <span className="fact-member-name">{m.name}</span>
                <button className={`vmark${m.vegan ? ' on' : ''}`} aria-pressed={m.vegan} title="Vegan" aria-label={`${m.name} is vegan`} onClick={() => updateMember(m, { vegan: !m.vegan })}>V</button>
                <button className="btn btn-ghost btn-sm" onClick={() => updateMember(m, { is_current: !m.is_current })}>{m.is_current ? 'Current' : 'Former'}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => removeMember(m)} aria-label={`Remove ${m.name}`}>Remove</button>
                <span className="band-meta fact-source">{m.source}</span>
              </div>
            ))}
            <div className="fact-member">
              <input className="input" aria-label="Add member" placeholder="Add member" value={newMember}
                onChange={(e) => setNewMember(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }} />
              <button className="btn btn-secondary btn-sm" onClick={addMember} disabled={!newMember.trim()}>Add</button>
            </div>
          </div>

          {artist.musicbrainz_id ? (
            <button className="btn btn-secondary btn-sm" onClick={fill} disabled={filling}>{filling ? 'Reading MusicBrainz…' : 'Fill from MusicBrainz'}</button>
          ) : (
            <div className="band-meta">
              Set a MusicBrainz link under Links to fill facts{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => onNeedIdentity('musicbrainz')}>Open Links</button>
            </div>
          )}

          {proposals && (
            <div className="fact-proposals">
              <div className="band-meta">Read MusicBrainz artist: {proposals.musicbrainz.name || 'unnamed'}</div>
              {nothingNew && <div className="band-meta">Nothing new to add</div>}
              {proposals.fields.map((p) => (
                <div key={p.field} className="fact-proposal">
                  <span>{FIELD_LABEL[p.field]}: {p.current !== null && <><s>{String(p.current)}</s>{' → '}</>}<strong>{String(p.proposed)}</strong></span>
                  <button className="btn btn-primary btn-sm" onClick={() => acceptField(p)}>Accept</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => dropField(p.field)}>Skip</button>
                </div>
              ))}
              {proposals.members.map((m) => (
                <div key={m.name} className="fact-proposal">
                  <span>Member: <strong>{m.name}</strong> ({MEMBER_CHANGE[m.change]}, {m.is_current ? 'current' : 'former'})</span>
                  <button className="btn btn-primary btn-sm" onClick={() => acceptMember(m)}>Accept</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => dropMember(m.name)}>Skip</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
export default ArtistFactsPanel;
