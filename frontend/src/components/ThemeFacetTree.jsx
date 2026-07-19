import { useState } from 'react';
import { subDimensionColor } from '../styles/subDimensionPalette';

const DIM_ORDER = ['themes', 'targets', 'actions', 'tactics', 'moral_frames'];

// Hierarchical analysis facet tree (Dimension -> Sub-dimension -> Group -> Code).
// Counts are distinct-song rollups from /api/analysis/facets; codes are coloured by
// sub-dimension (shared palette). All selections AND together (within and across groups).
function ThemeFacetTree({ facets, selected, onToggle, codedCount }) {
  const [open, setOpen] = useState(new Set(['themes'])); // dimension keys expanded

  const dims = DIM_ORDER.filter(k => facets && facets[k] && facets[k].sub_dimensions?.length);
  if (dims.length === 0) return null;

  const toggleOpen = (key) => {
    const next = new Set(open);
    next.has(key) ? next.delete(key) : next.add(key);
    setOpen(next);
  };

  return (
    <div className="filter-section theme-facet-tree">
      <h3 className="filter-title">Themes &amp; advocacy</h3>
      <p className="filter-note">
        Only songs with lyrics analysis ({codedCount}) are counted here; selections narrow together.
      </p>

      <div className="filter-options scrollable">
        {dims.map((dimKey) => {
          const dim = facets[dimKey];
          const isOpen = open.has(dimKey);
          return (
            <div key={dimKey} className="facet-dim">
              <button
                type="button"
                className="facet-dim-header"
                aria-expanded={isOpen}
                onClick={() => toggleOpen(dimKey)}
              >
                <span>{isOpen ? '▼' : '▶'} {dim.label}</span>
                <span className="filter-count">({dim.count})</span>
              </button>

              {isOpen && dim.sub_dimensions.map((sub) => (
                <div key={sub.id} className="facet-sub" style={{ borderLeftColor: subDimensionColor(sub.id) }}>
                  <div className="facet-sub-label" style={{ color: subDimensionColor(sub.id) }}>
                    {sub.label}
                  </div>
                  {sub.groups.map((group) => (
                    <div key={group.id} className="facet-group">
                      <div className="facet-group-label">{group.label}</div>
                      {group.codes.map((c) => (
                        <label key={c.code} className="filter-option facet-code">
                          <input
                            type="checkbox"
                            checked={(selected[dimKey] || []).includes(c.code)}
                            onChange={(e) => onToggle(dimKey, c.code, e.target.checked)}
                          />
                          <span className="filter-label">
                            <span>
                              <span className="facet-dot" style={{ background: subDimensionColor(sub.id) }} />
                              {c.label}
                            </span>
                            <span className="filter-count">({c.count})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ThemeFacetTree;
