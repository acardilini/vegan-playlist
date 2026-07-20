// Presentational chips row. The parent builds `chips` (key + label) and handles removal.
function FilterChips({ chips, onRemove }) {
  if (!chips || chips.length === 0) return null;
  return (
    <div className="filter-chips" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          className="filter-chip"
          onClick={() => onRemove(chip.key)}
          aria-label={`Remove filter ${chip.label}`}
        >
          <span className="filter-chip-label">{chip.label}</span>
          <span className="filter-chip-x" aria-hidden="true">✕</span>
        </button>
      ))}
    </div>
  );
}

export default FilterChips;
