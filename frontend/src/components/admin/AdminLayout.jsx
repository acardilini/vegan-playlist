import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ADMIN_PASSWORD } from '../../api/adminApi';

const AREAS = [
  ['/admin', 'Dashboard', true],       // index route → end match
  ['/admin/songs', 'Songs', false],
  ['/admin/artists', 'Artists', false],
  ['/admin/playlists', 'Playlists', false],
  ['/admin/data-quality', 'Data quality', false],
];

function AdminLayout() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');

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
          <NavLink key={to} to={to} end={end} className="admin-area-link">{label}</NavLink>
        ))}
        <button className="admin-logout" onClick={() => setAuthed(false)}>Log out</button>
      </nav>
      <main className="admin-main"><Outlet /></main>
    </div>
  );
}

export default AdminLayout;
