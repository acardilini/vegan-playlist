import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Reveal from './Reveal';

// Site-relative links stay in the SPA; external ones open in a new tab. react-markdown escapes raw HTML by default and no
// raw-HTML plugin is added: the story text arrives over HTTP from a file on disk.
const components = {
  a: ({ href, children }) => (
    href && href.startsWith('/')
      ? <Link to={href}>{children}</Link>
      : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};

// One passage of narrative between two visual panels.
function Prose({ markdown }) {
  return (
    <Reveal className="story-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
    </Reveal>
  );
}

export default Prose;
