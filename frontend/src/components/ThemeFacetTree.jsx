import { subDimensionColor } from '../styles/subDimensionPalette';
import FilterSection from './FilterSection';

const DIM_ORDER = ['themes', 'targets', 'actions', 'tactics', 'moral_frames'];
const keyOf = (dimKey, id) => `${dimKey}:${id}`;

// Hierarchical analysis facet tree. Every level below the dimension is a checkbox row,
// nested in a left rail so the four levels (Dimension -> Sub-dimension -> Group -> Code)
// read distinctly. A code = exact term; a group/sub-dimension = OR-term over its codes;
// all AND together (logic lives in the backend). Selecting an ancestor covers
// (checked+disabled) its descendants.
function ThemeFacetTree({ facets, selected, onToggle, selectedGroups = [], selectedSubdims = [], onToggleGroup, onToggleSubdim }) {
  const dims = DIM_ORDER.filter(k => facets && facets[k] && facets[k].sub_dimensions?.length);
  if (dims.length === 0) return null;

  const subSel = (dimKey, id) => selectedSubdims.includes(keyOf(dimKey, id));
  const grpSel = (dimKey, id) => selectedGroups.includes(keyOf(dimKey, id));
  const codeSel = (dimKey, code) => (selected[dimKey] || []).includes(code);

  return (
    <div className="theme-facet-tree">
      <div className="filter-options">
        {dims.map((dimKey) => {
          const dim = facets[dimKey];
          return (
            <FilterSection
              key={dimKey}
              title={`${dim.label} (${dim.count})`}
              description={dim.description}
            >
              {dim.sub_dimensions.map((sub) => {
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
            </FilterSection>
          );
        })}
      </div>
    </div>
  );
}

export default ThemeFacetTree;
