import { NavLink, Outlet, useLocation } from 'react-router-dom';

// A tab appears here only once it is built. `slice` tabs work on the shared slice (genre + years in the query string), so
// the query string travels with the user between them; Stories are a fixed argument and carry none.
const TABS = [
  { to: 'stories', label: 'Stories', slice: false },
  { to: 'over-time', label: 'Over time', slice: true },
  { to: 'arguments', label: 'Arguments', slice: true },
];

// Explore > Data: the tab row and a route per view. Stories read their own API; the slice views (Over time, Arguments) sit
// inside SliceLayout, which owns the dataset fetch and the slice bar.
function DataPage() {
  const { pathname, search } = useLocation();
  const onSliceTab = TABS.some(t => t.slice && pathname.endsWith(`/${t.to}`));
  return (
    <div className="data-page">
      <nav className="data-tabs" aria-label="Data views">
        {TABS.map(t => (
          <NavLink key={t.to} to={{ pathname: t.to, search: t.slice && onSliceTab ? search : '' }}
            className={({ isActive }) => `data-tab-link ${isActive ? 'active' : ''}`}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

export default DataPage;
