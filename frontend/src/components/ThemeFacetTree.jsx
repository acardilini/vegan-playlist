import { useState } from 'react';
import { subDimensionColor } from '../styles/subDimensionPalette';

const DIM_ORDER = ['themes', 'targets', 'actions', 'tactics', 'moral_frames'];
const keyOf = (dimKey, id) => `${dimKey}:${id}`;

// Hierarchical analysis facet tree. Every level below the dimension is a checkbox row,
// nested in a left rail so the four levels (Dimension -> Sub-dimension -> Group -> Code)
// read distinctly. A code = exact term; a group/sub-dimension = OR-term over its codes;
// all AND together (logic lives in the backend). Selecting an ancestor covers
// (checked+disabled) its descendants.
function ThemeFacetTree({ facets, selected, onToggle, codedCount, selectedGroups = [], selectedSubdims = [], onToggleGroup, onToggleSubdim }) {
  const [open, setOpen] = useState(new Set(['themes']));
  const dims = DIM_ORDER.filter(k => facets && facets[k] && facets[k].sub_dimensions?.length);
  if (dims.length === 0) return null;

  const toggleOpen = (k) => { const n = new Set(open); n.has(k) ? n.delete(k) : n.add(k); setOpen(n); };
  const subSel = (dimKey, id) => selectedSubdims.includes(keyOf(dimKey, id));
  const grpSel = (dimKey, id) => selectedGroups.includes(keyOf(dimKey, id));
  const codeSel = (dimKey, code) => (selected[dimKey] || []).includes(code);

  return (
    <div className="filter-section theme-facet-tree">
      <h3 className="filter-title">Themes &amp; advocacy</h3>
      <p className="filter-note">
        Only songs with lyrics analysis ({codedCount}) are counted here. Pick a group or sub-dimension for any code inside it; picks narrow together.
      </p>

      <div className="filter-options scrollable">
        {dims.map((dimKey) => {
          const dim = facets[dimKey];
          const isOpen = open.has(dimKey);
          return (
            <div key={dimKey} className="facet-dim">
              <button type="button" className="facet-dim-header" aria-expanded={isOpen} onClick={() => toggleOpen(dimKey)}>
                <span>{isOpen ? '▼' : '▶'} {dim.label}</span>
                <span className="filter-count">({dim.count})</span>
              </button>

              {isOpen && dim.sub_dimensions.map((sub) => {
                const hue = subDimensionColor(sub.id);
                const subOn = subSel(dimKey, sub.id);
                const subZero = sub.count === 0 && !subOn;
                return (
                  <div key={sub.id} className="facet-sub">
                    <label className={`filter-option facet-subdim ${subZero ? 'is-zero' : ''}`}>
                      <input type="checkbox" checked={subOn} disabled={subZero}
                        onChange={(e) => onToggleSubdim(dimKey, sub.id, e.target.checked)} />
                      <span className="filter-label">
                        <span className="facet-subdim-label" style={{ color: hue }}>
                          <span className="facet-dot" style={{ background: hue }} />{sub.label}
                        </span>
                        <span className="filter-count">({sub.count})</span>
                      </span>
                    </label>

                    <div className="facet-rail" style={{ borderLeftColor: hue }}>
                      {sub.groups.map((group) => {
                        const grpOn = grpSel(dimKey, group.id);
                        const grpChecked = grpOn || subOn;      // covered by its sub-dimension
                        const grpZero = group.count === 0 && !grpChecked;
                        return (
                          <div key={group.id} className="facet-group">
                            <label className={`filter-option facet-grouprow ${grpZero ? 'is-zero' : ''}`}>
                              <input type="checkbox" checked={grpChecked} disabled={subOn || grpZero}
                                onChange={(e) => onToggleGroup(dimKey, group.id, e.target.checked)} />
                              <span className="filter-label">
                                <span className="facet-group-label">{group.label}</span>
                                <span className="filter-count">({group.count})</span>
                              </span>
                            </label>

                            <div className="facet-rail facet-rail-neutral">
                              {group.codes.map((c) => {
                                const covered = subOn || grpOn;    // ancestor covers the code
                                const cChecked = codeSel(dimKey, c.code) || covered;
                                const cZero = c.count === 0 && !cChecked;
                                return (
                                  <label key={c.code} className={`filter-option facet-code ${cZero ? 'is-zero' : ''}`}>
                                    <input type="checkbox" checked={cChecked} disabled={covered || cZero}
                                      onChange={(e) => onToggle(dimKey, c.code, e.target.checked)} />
                                    <span className="filter-label">
                                      <span><span className="facet-dot" style={{ background: hue }} />{c.label}</span>
                                      <span className="filter-count">({c.count})</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ThemeFacetTree;
