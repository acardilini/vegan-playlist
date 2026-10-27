import { useState } from 'react';
import { adminFetch } from '../../api/adminApi';
import { SaveTag } from './SavedField';

// "Fill from Spotify link": reads the track behind the song's own Spotify URL, shows current vs Spotify,
// and applies only the ticked fields. Title is left unticked by default (titles are often edited by hand).
// Rendered with key={wb.id} so it resets when the curator moves to another song.
function SpotifyFill({ wb, savePanel }) {
  const [phase, setPhase] = useState('idle'); // idle | loading | review | applying
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const check = async () => {
    setPhase('loading'); setError(''); setDone(false);
    try {
      const r = await adminFetch(`/api/admin/workbench/${wb.id}/spotify-fill`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Could not check Spotify'); setPhase('idle'); return; }
      const blocked = (key) => key === 'spotify_id' && d.conflict;
      setPicked(Object.fromEntries(d.fields.map((f) => [f.key, f.differs && f.key !== 'title' && !blocked(f.key)])));
      setData(d);
      setPhase('review');
    } catch { setError('Request failed'); setPhase('idle'); }
  };

  const apply = async () => {
    const fields = Object.keys(picked).filter((k) => picked[k]);
    if (!fields.length) return;
    setPhase('applying'); setError('');
    const res = await savePanel('spotify-fill', { fields });
    if (res && res.ok) { setData(null); setPhase('idle'); setDone(true); } else { setError((res && res.error) || 'Save failed'); setPhase('review'); }
  };

  if (phase === 'idle' || phase === 'loading') {
    return (
      <div className="wb-fill">
        <button type="button" className="btn btn-secondary btn-sm" onClick={check} disabled={phase === 'loading'}>
          {phase === 'loading' ? 'Checking Spotify…' : 'Fill from Spotify link'}
        </button>
        {done && <SaveTag status="saved" />}
        {error && <p className="wb-fill-error" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="wb-fill wb-fill-review">
      <table className="wb-fill-table">
        <thead><tr><th scope="col" /><th scope="col">Now</th><th scope="col">Spotify</th></tr></thead>
        <tbody>
          {data.fields.map((f) => {
            const blocked = f.key === 'spotify_id' && data.conflict;
            return (
              <tr key={f.key} className={f.differs ? '' : 'wb-fill-same'}>
                <td>
                  <label>
                    <input type="checkbox" checked={!!picked[f.key]} disabled={!f.differs || !!blocked || phase === 'applying'}
                      onChange={(e) => setPicked({ ...picked, [f.key]: e.target.checked })} /> {f.label}
                  </label>
                </td>
                <td>{f.current}</td>
                <td>{f.differs ? f.spotify : 'same'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.conflict && (
        <p className="wb-fill-error">Spotify id not available: song #{data.conflict.song_id} ("{data.conflict.title}") already has this track.</p>
      )}
      {error && <p className="wb-fill-error" role="alert">{error}</p>}
      <div className="wb-fill-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={apply}
          disabled={phase === 'applying' || !Object.values(picked).some(Boolean)}>
          {phase === 'applying' ? 'Applying…' : 'Apply ticked'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPhase('idle'); setData(null); }}
          disabled={phase === 'applying'}>Cancel</button>
      </div>
    </div>
  );
}
export default SpotifyFill;
