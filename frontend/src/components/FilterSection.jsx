import { useState } from 'react';

// One collapsible sidebar section. Every filter group uses this so the whole panel behaves
// identically: a header button that toggles, a selected-count badge, and an optional
// description that appears with the body on expand. Nests — a FilterSection inside another
// one's children is how the theme dimensions and metadata components are grouped.
function FilterSection({ title, count = 0, description, defaultOpen = false, children }) {
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
          {description && <p className="filter-note">{description}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

export default FilterSection;
