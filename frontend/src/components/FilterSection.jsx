import { useState } from 'react';

// One collapsible sidebar section. Every filter group uses this so the whole panel behaves
// identically. Nests — a FilterSection inside another one's children is how the theme
// dimensions and metadata components are grouped.
//
// `note` is usage help only: caveats and what the options mean. Definitional text ("what
// this filter is") is deliberately NOT shown here — the curator found both the always-on
// prose and the "i" tooltips that replaced it cluttering. That copy lives on the About
// pages instead; the API still serves it (see analysis.scalarFacets / facetTree).
function FilterSection({ title, count = 0, note, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="filter-section">
      <button
        type="button"
        className="filter-title filter-title-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span>{title}{count > 0 && <span className="filter-badge">{count}</span>}</span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="filter-section-body">
          {note && <p className="filter-note">{note}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

export default FilterSection;
