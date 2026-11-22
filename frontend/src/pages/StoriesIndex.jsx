import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// The Stories tab: one card per story, with the cover art of its opening song.
function StoriesIndex() {
  const [state, setState] = useState({ status: 'loading', list: [] });
  useEffect(() => {
    let live = true;
    fetch('/api/stories')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((list) => { if (live) setState({ status: 'ready', list }); })
      .catch(() => { if (live) setState({ status: 'error', list: [] }); });
    return () => { live = false; };
  }, []);

  if (state.status === 'loading') return <p className="data-status" role="status">Loading the stories&hellip;</p>;
  if (state.status === 'error') return <p className="data-status" role="alert">The stories could not be loaded. Please try again in a moment.</p>;
  if (!state.list.length) return <p className="data-status">No stories yet.</p>;
  return (
    <ul className="stories-index">
      {state.list.map((s) => (
        <li key={s.slug}>
          <Link to={`/explore/data/stories/${s.slug}`} className="stories-card">
            {s.cover ? <img src={s.cover} alt="" loading="lazy" /> : <span className="stories-card-noart" aria-hidden="true" />}
            <span className="stories-card-title">{s.title}</span>
            {s.subtitle && <span className="stories-card-sub">{s.subtitle}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default StoriesIndex;
