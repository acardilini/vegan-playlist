import { useState } from 'react';
import { AutoText } from './SavedField';

function ArtistDetailsPanel({ artist, save }) {
  const [boxError, setBoxError] = useState('');
  // Controlled by artist state: a failed save leaves the saved value showing and says so.
  const toggleNoNotes = async (checked) => {
    setBoxError('');
    const res = await save({ no_advocacy_notes_needed: checked });
    if (!res.ok) setBoxError(res.error || 'Save failed');
  };
  return (
    <section className="wb-panel">
      <h2>Details</h2>
      <AutoText label="Biography" initial={artist.bio} multiline rows={5} onSave={(v) => save({ bio: v })} />
      <AutoText label="Vegan advocacy notes" initial={artist.vegan_advocacy_notes} multiline rows={4}
        onSave={(v) => save({ vegan_advocacy_notes: v })} />
      <label className="wb-check" style={{ display: "flex", margin: "var(--space-2) 0" }}>
        <input type="checkbox" checked={!!artist.no_advocacy_notes_needed}
          onChange={(e) => toggleNoNotes(e.target.checked)} />
        {' '}No advocacy notes needed
      </label>
      {boxError && <div className="admin-message error">{boxError}</div>}
    </section>
  );
}
export default ArtistDetailsPanel;
