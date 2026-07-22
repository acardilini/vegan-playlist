import FilterSection from './FilterSection';

// The seven scalar analysis components as collapsible checkbox groups. Options, labels,
// counts and the description all come from the API (`scalar_facets`) — the codebook lives
// in the backend only. Selecting several codes in one group widens (OR); selecting across
// groups narrows (AND).
function ScalarFacetGroups({ groups, selected, onToggle }) {
  const keys = Object.keys(groups || {});
  if (keys.length === 0) return null;

  return (
    <>
      {keys.map(key => {
        const g = groups[key];
        const sel = selected[key] || [];
        return (
          <FilterSection key={key} title={g.heading} count={sel.length} description={g.description}>
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
          </FilterSection>
        );
      })}
    </>
  );
}

export default ScalarFacetGroups;
