import './App.css'
import './styles/components.css' // design system — must come after App.css to win the cascade
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import NavigationMenu from './components/NavigationMenu';
import HomePage from './pages/HomePage';
import SongDetailPage from './pages/SongDetailPage';
import PlaylistsPage from './pages/PlaylistsPage';
import PlaylistDetailPage from './pages/PlaylistDetailPage';
import AboutPage from './pages/AboutPage';
import SearchResults from './components/SearchResults';
import ArtistSearchResults from './components/ArtistSearchResults';
import ArtistDetailPage from './components/ArtistDetailPage';
import AdminInterface from './components/AdminInterface';
import SongSubmissionForm from './components/SongSubmissionForm';
import DataDashboard from './components/DataDashboard';

function App() {
  return (
    <Router>
      <div className="app-container">
        <header className="app-header">
          <div className="header-content">
            <Link to="/" className="site-title">The Vegan Playlist</Link>
            <NavigationMenu />
          </div>
        </header>

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/song/:songId" element={<SongDetailPage />} />
          <Route path="/artists" element={<ArtistSearchResults />} />
          <Route path="/artist/:artistId" element={<ArtistDetailPage />} />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/playlist/:playlistId" element={<PlaylistDetailPage />} />
          <Route path="/submit" element={<SongSubmissionForm />} />
          <Route path="/dashboard" element={<DataDashboard />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/admin" element={<AdminInterface />} />
        </Routes>

        <footer className="app-footer">
          <p>&copy; {new Date().getFullYear()} The Vegan Playlist</p>
        </footer>
      </div>
    </Router>
  );
}

export default App
