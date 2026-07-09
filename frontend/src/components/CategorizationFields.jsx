// Shared categorisation form: the five curator category arrays (+ optional rating).
// Single implementation behind every categorisation entry point — the Manage Songs
// manual-song form, the Manage Songs edit modal, and the Bulk Categorization
// workflow (curator decision 2026-07-08: one form, both entry points kept).
const CATEGORY_FIELDS = [
  ['vegan_focus', 'Vegan Focus'],
  ['animal_category', 'Animal Category'],
  ['advocacy_style', 'Advocacy Style'],
  ['advocacy_issues', 'Advocacy Issues'],
  ['lyrical_explicitness', 'Lyrical Approach'],
];

function CategorizationFields({ options, values, onToggle, rating, onRatingChange }) {
  return (
    <div className="compact-form-grid">
      {CATEGORY_FIELDS.map(([field, title]) => {
        const selected = values?.[field] || [];
        const available = options?.[field] || [];
        // Keep values visible even if they aren't in the options list yet
        const all = [...new Set([...available, ...selected])];
        return (
          <div key={field} className="compact-form-group">
            <label className="compact-label">{title}</label>
            {all.length === 0 ? (
              <span style={{ fontSize: 12, color: '#888' }}>No options yet</span>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {all.map(option => {
                  const active = selected.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => onToggle(field, option)}
                      style={{
                        padding: '4px 10px', borderRadius: 12, fontSize: 12, cursor: 'pointer',
                        border: active ? '1px solid #007bff' : '1px solid #ccc',
                        background: active ? '#007bff' : '#fff',
                        color: active ? '#fff' : '#333',
                      }}
                    >
                      {option.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {onRatingChange && (
        <div className="compact-form-group">
          <label className="compact-label">Rating</label>
          <select
            className="compact-select"
            value={rating || ''}
            onChange={(e) => onRatingChange(e.target.value)}
          >
            <option value="">No rating</option>
            <option value="1">1 - Poor</option>
            <option value="2">2 - Fair</option>
            <option value="3">3 - Good</option>
            <option value="4">4 - Very Good</option>
            <option value="5">5 - Excellent</option>
          </select>
        </div>
      )}
    </div>
  );
}

export default CategorizationFields;
