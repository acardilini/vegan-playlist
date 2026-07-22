import { useState } from 'react';
import InfoTip from './InfoTip';

// One collapsible sidebar section. Every filter group uses this so the whole panel behaves
// identically. Nests — a FilterSection inside another one's children is how the theme
// dimensions and metadata components are grouped.
//
// Two kinds of help text, deliberately separated (curator, 2026-07-22): `description` says
// what the filter IS and lives behind the heading's "i" tooltip, because always-on prose
// under every group was distracting; `note` says how to USE the filter (caveats, what the
// options mean) and stays visible in the body.
//
// The icon is a sibling of the toggle button, not a child: a <button> inside a <button> is
// invalid, and this codebase has hit that before.
function FilterSection({ title, count = 0, description, note, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="filter-section">
      <div className="filter-section-head">
        <button
          type="button"
          className="filter-title filter-title-toggle"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span>{title}{count > 0 && <span className="filter-badge">{count}</span>}</span>
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
        {description && <InfoTip icon text={description} label={`About ${title}`} />}
      </div>
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
