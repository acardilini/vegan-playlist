import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';
import AddSongPanel from './AddSongPanel';

// Action tiles: [queueKey, label, disabled]. Inbox is disabled until sub-project C.
const TILES = [
  ['to-process', 'To be processed', false],
  ['needs-lyrics', 'Needs lyrics', false],
  ['needs-cover', 'Needs cover', false],
  ['needs-video', 'Needs video', false],
  ['to-finalise', 'To finalise', false],
  ['inbox', 'Inbox', true],
];

function relTime(ts) {
  if (!ts) return '';
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Status pill text reuses the existing .queue-status.{pending,live,included,rejected} classes.
function statusLabel(s) {
  if (s.status === 'included') return s.published ? 'live' : 'included';
  return s.status; // 'pending' | 'rejected'
}

function Dashboard() {
  const [counts, setCounts] = useState(null);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(() => {
    adminFetch('/api/admin/curation/counts')
      .then(r => (r.ok ? r.json() : null)).then(setCounts).catch(() => setCounts(null));
    adminFetch('/api/admin/curation/catalogue-stats')
      .then(r => (r.ok ? r.json() : null)).then(setStats).catch(() => setStats(null));
    adminFetch('/api/admin/curation/recent')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setRecent(Array.isArray(d) ? d : [])).catch(() => setRecent([]));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="admin-dashboard">
      <div className="queue-toolbar">
        <h1>Dashboard</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add a song</button>
      </div>

      <section className="dash-section">
        <h2 className="dash-heading">Needs your attention</h2>
        <div className="dash-tiles">
          {TILES.map(([key, label, disabled]) => {
            const n = counts ? (counts[key] ?? 0) : '·';
            if (disabled) {
              return (
                <div key={key} className="dash-tile disabled" aria-disabled="true">
                  <span className="dash-tile-n">{n}</span>
                  <span className="dash-tile-label">{label}</span>
                  <span className="dash-tile-soon">soon</span>
                </div>
              );
            }
            return (
              <Link key={key} className="dash-tile" to={`/admin/songs?queue=${key}`}>
                <span className="dash-tile-n">{n}</span>
                <span className="dash-tile-label">{label}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-heading">Catalogue health</h2>
        <p className="dash-health">
          {stats ? (
            <>
              <strong>{stats.total.toLocaleString()}</strong> songs · {stats.live.toLocaleString()} live ·{' '}
              {stats.toFinalise} to finalise · {stats.pending} pending · {stats.rejected} rejected
            </>
          ) : '·'}
        </p>
      </section>

      <section className="dash-section">
        <h2 className="dash-heading">Recent activity</h2>
        {recent.length === 0 ? (
          <p className="queue-empty">No recent activity.</p>
        ) : (
          <ul className="dash-recent">
            {recent.map(s => (
              <li key={s.id}>
                <Link to={`/admin/song/${s.id}`} className="dash-recent-row">
                  <span className="dash-recent-meta">
                    <span className="dash-recent-title">{s.title}</span>
                    <span className="dash-recent-artist">{s.artists}</span>
                  </span>
                  <span className={`queue-status ${statusLabel(s)}`}>{statusLabel(s)}</span>
                  <span className="dash-recent-time">{relTime(s.updated_at)}</span>
                  <span className="dash-recent-arrow" aria-hidden="true">{'→'}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {showAdd && <AddSongPanel onClose={() => setShowAdd(false)} onAdded={load} />}
    </div>
  );
}
export default Dashboard;
