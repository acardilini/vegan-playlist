import { Link } from 'react-router-dom';
import Reveal from './Reveal';

// The hand-off: opens the matching filter in Browse.
function ClosingPanel({ block }) {
  return (
    <Reveal className="story-closing">
      <Link to={block.href}>{block.label}</Link>
    </Reveal>
  );
}

export default ClosingPanel;
