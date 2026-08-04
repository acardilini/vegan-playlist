import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { substituteTokens } from '../utils/contentTokens';

// Renders one curator-editable Markdown page.
//
// The API copy wins, so an edit to backend/data/*.md is live on the next browser refresh
// with no rebuild. `fallback` is the SAME file, imported at build time with Vite's ?raw, and
// is used only when the fetch fails. It is therefore a build-time snapshot and is SUPPOSED
// to go stale after an edit — it exists for an unreachable API, not for freshness. Do not
// "fix" that by copying the file at build time or by refetching it.
//
// Relative URL so it goes through the Vite proxy — never hardcode localhost:5000.
function MarkdownPage({ slug, fallback, tokens = {} }) {
  const [markdown, setMarkdown] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/content/${slug}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(body => { if (!cancelled) setMarkdown(body.markdown); })
      // No error UI: a visitor should never see the site's own plumbing. The bundled copy is
      // real content, so falling back to it is a complete answer, not a degraded one.
      .catch(() => { if (!cancelled) setMarkdown(fallback); });
    return () => { cancelled = true; };
  }, [slug, fallback]);

  // The fetch is local and fast; a spinner would flash rather than inform.
  if (markdown === null) return null;

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {substituteTokens(markdown, tokens)}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownPage;
