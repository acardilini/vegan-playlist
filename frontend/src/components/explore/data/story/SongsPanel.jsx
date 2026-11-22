import { Link } from 'react-router-dom';
import Reveal from './Reveal';

// Two to four songs that show what the text just said: album art, title, band, year, the curator's caption.
function SongsPanel({ block }) {
  return (
    <Reveal as="section" className="story-songs">
      {block.songs.map((s) => (
        <Link key={s.id} className="story-song" to={`/song/${s.id}`}>
          {s.art ? <img src={s.art} alt="" loading="lazy" /> : <span className="story-song-noart" aria-hidden="true" />}
          <span className="story-song-title">{s.title}</span>
          <span className="story-song-meta">{[s.artists, s.year].filter(Boolean).join(' · ')}</span>
          {s.caption && <span className="story-song-caption">{s.caption}</span>}
        </Link>
      ))}
    </Reveal>
  );
}

export default SongsPanel;
