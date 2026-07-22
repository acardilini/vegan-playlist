import { useState } from 'react';

// Flat, collapsed-by-default checkbox groups for the seven scalar analysis components.
// Options, labels and counts all come from the API (`scalar_facets`) — the codebook lives
// in the backend only. Selecting several codes in one group widens (OR); selecting across
// groups narrows (AND).
function ScalarFacetGroups({ groups, selected, onToggle }) {
  const [open, setOpen] = useState({});
  const keys = Object.keys(groups || {});
  if (keys.length === 0) return null;

  return (
    <>
      {keys.map(key => {
        const g = groups[key];
        const sel = selected[key] || [];
        const isOpen = !!open[key];
        return (
          <div key={key} className="filter-section">
            <button
              type="button"
              className="filter-title filter-title-toggle"
              aria-expanded={isOpen}
              onClick={() => setOpen(o => ({ ...o, [key]: !o[key] }))}
            >
              <span>{g.heading}{sel.length > 0 && <span className="filter-badge">{sel.length}</span>}</span>
              <span aria-hidden="true">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <div className="filter-options">
                {g.options.map(o => {
                  const isSel = sel.includes(o.code);
                  const zero = o.count === 0 && !isSel;
                  return (
                    <label key={o.code} className={`filter-option ${zero ? 'is-zero' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isSel}
                        disabled={zero}
                        onChange={(e) => onToggle(key, o.code, e.target.checked)}
                      />
                      <span className="filter-label">
                        {o.label}<span className="filter-count">({o.count})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export default ScalarFacetGroups;
