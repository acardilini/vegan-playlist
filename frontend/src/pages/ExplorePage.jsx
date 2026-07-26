import { NavLink, Outlet } from 'react-router-dom';

// Two ways of looking at the whole catalogue: the vector map, and the analytics the
// standalone /dashboard used to serve. Tabs are real routes so each is linkable.
function ExplorePage() {
  return (
    <div className="explore-page">
      <header className="explore-head">
        <h1>Explore</h1>
        <nav className="explore-tabs" aria-label="Explore views">
          <NavLink to="/explore" end className={({ isActive }) => `explore-tab ${isActive ? 'active' : ''}`}>
            Map
          </NavLink>
          <NavLink to="/explore/data" className={({ isActive }) => `explore-tab ${isActive ? 'active' : ''}`}>
            Data
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export default ExplorePage;
