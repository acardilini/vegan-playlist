import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Prose from '../components/explore/data/story/Prose';
import OpeningPanel from '../components/explore/data/story/OpeningPanel';
import DecadeBarsPanel from '../components/explore/data/story/DecadeBarsPanel';
import DecadeLinesPanel from '../components/explore/data/story/DecadeLinesPanel';
import SongsPanel from '../components/explore/data/story/SongsPanel';
import ClosingPanel from '../components/explore/data/story/ClosingPanel';
import { colourSlots } from '../components/explore/data/story/storyModel';

function renderBlock(block, i, slots) {
  switch (block.type) {
    case 'prose': return <Prose key={i} markdown={block.markdown} />;
    case 'opening': return <OpeningPanel key={i} block={block} />;
    case 'songs': return <SongsPanel key={i} block={block} />;
    case 'closing': return <ClosingPanel key={i} block={block} />;
    case 'chart':
      return block.variant === 'decade-lines'
        ? <DecadeLinesPanel key={i} chart={block} slots={slots} />
        : <DecadeBarsPanel key={i} chart={block} slots={slots} />;
    default: return null;
  }
}

// One story: narrative passages that emerge as you scroll, between full-width visual panels.
function StoryPage() {
  const { slug } = useParams();
  const [state, setState] = useState({ slug: null, status: 'loading', story: null });

  useEffect(() => {
    let live = true;
    fetch(`/api/stories/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((story) => { if (live) setState({ slug, status: 'ready', story }); })
      .catch((e) => { if (live) setState({ slug, status: e.message === '404' ? 'missing' : 'error', story: null }); });
    return () => { live = false; };
  }, [slug]);

  const story = state.slug === slug ? state.story : null;
  const slots = useMemo(() => colourSlots(story ? story.blocks : []), [story]);
  const status = state.slug === slug ? state.status : 'loading';

  if (status === 'loading') return <p className="data-status" role="status">Loading the story&hellip;</p>;
  if (status !== 'ready') {
    return (
      <p className="data-status" role="alert">
        {status === 'missing' ? 'There is no story here.' : 'The story could not be loaded.'} <Link to="/explore/data/stories">All stories</Link>
      </p>
    );
  }
  return (
    <article className="story">
      <Link className="story-back" to="/explore/data/stories">All stories</Link>
      {story.blocks.map((b, i) => renderBlock(b, i, slots))}
    </article>
  );
}

export default StoryPage;
