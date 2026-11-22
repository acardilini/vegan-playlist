import { NavLink, Outlet } from 'react-router-dom';

// A tab appears here only once it is built.
const TABS = [
  { to: 'stories', label: 'Stories' },
  { to: 'over-time', label: 'Over time' },
];

// Explore > Data: the tab row and a route per view. Stories read their own API; the slice views (Over time) sit inside
// SliceLayout, which owns the dataset fetch and the slice bar.
function DataPage() {
  return (
    <div className="data-page">
      <nav className="data-tabs" aria-label="Data views">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => `data-tab-link ${isActive ? 'active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export default DataPage;
