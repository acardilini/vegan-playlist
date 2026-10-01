import { NavLink, Outlet } from 'react-router-dom';

// Three ways into the same subject: what the collection is, how its descriptions are
// produced, and the full vocabulary those descriptions use. Tabs are real routes so each is
// linkable. Mirrors ExplorePage.
//
// The shell owns the page's single <h1> — the three tab bodies must not add another (the
// .md files start at ##).
function AboutPage() {
  const tab = ({ isActive }) => `about-tab ${isActive ? 'active' : ''}`;

  return (
    <div className="page-container about-page">
      <header className="about-head">
        <h1>About The Vegan Playlist</h1>
        <nav className="about-tabs" aria-label="About sections">
          <NavLink to="/about" end className={tab}>About</NavLink>
          <NavLink to="/about/analysis" className={tab}>How the analysis works</NavLink>
          <NavLink to="/about/reference" className={tab}>Reference</NavLink>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

export default AboutPage;
