import { useState } from 'react';

// Backend-driven genre tree (data from /filter-options genre_tree). No hardcoded
// hierarchy or counts — parents/subgenres/counts all come from the effective-genre
// rollup so the numbers match what filtering returns.
const COLLAPSED_COUNT = 6;

function GenreFilterTree({ tree, selectedGenres, selectedParents, onToggleParent, onToggleGenre }) {
  const [expanded, setExpanded] = useState(new Set());
  const [term, setTerm] = useState('');
  const [showAll, setShowAll] = useState(false);

  const parents = tree?.parents || [];
  const q = term.trim().toLowerCase();

  const matchParent = (p) =>
    !q || p.value.toLowerCase().includes(q) || p.subgenres.some(s => s.value.toLowerCase().includes(q));

  const toggleExpand = (value) => {
    const next = new Set(expanded);
    next.has(value) ? next.delete(value) : next.add(value);
    setExpanded(next);
  };

  const visibleParents = parents.filter(matchParent);
  // Searching shows every match; otherwise the list is cut to a handful (parents with a pick stay visible).
  const shown = (q || showAll) ? visibleParents
    : visibleParents.filter((p, i) => i < COLLAPSED_COUNT || selectedParents.includes(p.value)
        || p.subgenres.some(s => selectedGenres.includes(s.value)));
  const hiddenCount = visibleParents.length - shown.length;

  return (
    <div className="hierarchical-genre-filter">
      <div className="filter-search">
        <input
          type="text"
          className="filter-search-input"
          placeholder="Search genres…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>

      <div className="filter-options">
        {shown.map((parent) => {
          const isExpanded = expanded.has(parent.value) || !!q;
          const subs = q ? parent.subgenres.filter(s => s.value.toLowerCase().includes(q)) : parent.subgenres;
          const subValues = parent.subgenres.map(s => s.value);
          return (
            <div key={parent.value} className="genre-hierarchy-item">
              <div className="parent-genre-row">
                <button
                  className="expand-toggle"
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${parent.value} subgenres`}
                  onClick={() => toggleExpand(parent.value)}
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
                <label className={`filter-option parent-genre ${parent.count === 0 && !selectedParents.includes(parent.value) ? 'is-zero' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={parent.count === 0 && !selectedParents.includes(parent.value)}
                    checked={selectedParents.includes(parent.value)}
                    onChange={(e) => onToggleParent(parent.value, e.target.checked, subValues)}
                  />
                  <span className="filter-label">
                    <strong>{parent.value}</strong>
                    <span className="filter-count">({parent.count})</span>
                  </span>
                </label>
              </div>

              {isExpanded && (
                <div className="subgenres-container">
                  {subs.map((sub) => {
                    const zero = sub.count === 0 && !selectedGenres.includes(sub.value);
                    return (
                      <label key={sub.value} className={`filter-option subgenre ${zero ? 'is-zero' : ''}`}>
                        <input type="checkbox" disabled={zero}
                          checked={selectedGenres.includes(sub.value)}
                          onChange={(e) => onToggleGenre(sub.value, e.target.checked)} />
                        <span className="filter-label">{sub.value}<span className="filter-count">({sub.count})</span></span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {!q && (hiddenCount > 0 || showAll) && visibleParents.length > COLLAPSED_COUNT && (
          <button type="button" className="show-more" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Show fewer' : `Show ${hiddenCount} more`}
          </button>
        )}
      </div>

      {tree?.uncovered_count > 0 && (
        <p className="filter-note">{tree.uncovered_count} songs have no genre tag.</p>
      )}
    </div>
  );
}

export default GenreFilterTree;
