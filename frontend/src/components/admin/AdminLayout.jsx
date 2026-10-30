import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ADMIN_PASSWORD, adminFetch } from '../../api/adminApi';

const AREAS = [
  ['/admin', 'Dashboard', true],       // index route → end match
  ['/admin/songs', 'Songs', false],
  ['/admin/artists', 'Artists', false],
  ['/admin/leads', 'Leads', false],
  ['/admin/crosscheck', 'Playlist cross-check', false],
  ['/admin/playlists', 'Playlists', false],
  ['/admin/data-quality', 'Data quality', false],
];

function AdminLayout() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [leadCount, setLeadCount] = useState(0); // leads still to look into, shown on the Leads tab

  // Fetched once after login, and again whenever the Leads area changes a lead.
  useEffect(() => {
    if (!authed) return undefined;
    const refresh = () => adminFetch('/api/admin/leads?status=new')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.counts) setLeadCount(d.counts.new); })
      .catch(() => {});
    refresh();
    window.addEventListener('leads-changed', refresh);
    return () => window.removeEventListener('leads-changed', refresh);
  }, [authed]);

  const login = (e) => {
    e.preventDefault();
    if (pw === ADMIN_PASSWORD) { setAuthed(true); setError(''); }
    else setError('Invalid admin password');
  };

  if (!authed) {
    return (
      <div className="admin-login">
        <h2>Admin access</h2>
        <p className="admin-stub">Enter the admin password to continue.</p>
        {error && <div className="admin-message error">{error}</div>}
        <form onSubmit={login}>
          <input className="input" type="password" placeholder="Admin password"
            value={pw} onChange={(e) => setPw(e.target.value)} required
            style={{ width: '100%', marginBottom: 'var(--space-3)' }} />
          <button className="btn btn-primary" type="submit" style={{ width: '100%' }}>Log in</button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <nav className="admin-topbar">
        <div className="admin-brand">Admin</div>
        {AREAS.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={end} className="admin-area-link">{to === '/admin/leads' && leadCount > 0 ? `${label} (${leadCount})` : label}</NavLink>
        ))}
        <button className="admin-logout" onClick={() => setAuthed(false)}>Log out</button>
      </nav>
      <main className="admin-main"><Outlet /></main>
    </div>
  );
}

export default AdminLayout;
