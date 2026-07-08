import { useNavigate } from 'react-router-dom';

function NavigationMenu() {
  const navigate = useNavigate();
  const location = window.location;

  const handleNavClick = (path) => {
    navigate(path);
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <nav className="navigation-menu">
      <ul>
        <li className={`nav-item ${isActive('/') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/', 'Home'); }}>
            Home
          </a>
        </li>
        <li className={`nav-item ${isActive('/artists') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/artists', 'Artists'); }}>
            Artists
          </a>
        </li>
        <li className={`nav-item ${isActive('/playlists') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/playlists', 'Playlists'); }}>
            Playlists
          </a>
        </li>
        <li className={`nav-item ${isActive('/submit') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/submit', 'Submit'); }}>
            Submit Song
          </a>
        </li>
        <li className={`nav-item ${isActive('/dashboard') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/dashboard', 'Dashboard'); }}>
            Dashboard
          </a>
        </li>
        <li className={`nav-item ${isActive('/about') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/about', 'About'); }}>
            About
          </a>
        </li>
        <li className={`nav-item ${isActive('/admin') ? 'active' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); handleNavClick('/admin', 'Admin'); }}>
            Admin
          </a>
        </li>
      </ul>
    </nav>
  );
}

export default NavigationMenu;
