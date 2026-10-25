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
      <AutoText label="Name" initial={artist.name} onSave={(v) => save({ name: v })} />
      <AutoText label="Biography" initial={artist.bio} multiline rows={5} onSave={(v) => save({ bio: v })} />
      <AutoText label="Vegan advocacy notes" initial={artist.vegan_advocacy_notes} multiline rows={4}
        onSave={(v) => save({ vegan_advocacy_notes: v })} />
      <label className="wb-check" style={{ display: "flex", margin: "var(--space-2) 0" }}>
        <input type="checkbox" checked={!!artist.no_advocacy_notes_needed}
          onChange={(e) => toggleNoNotes(e.target.checked)} />
        {' '}No advocacy notes needed
      </label>
      {boxError && <div className="admin-message error">{boxError}</div>}
      <AutoText label="Genres (comma-separated)" initial={(artist.genres || []).join(', ')}
        onSave={(v) => save({ genres: v.split(',').map((g) => g.trim()).filter(Boolean) })} />
    </section>
  );
}
export default ArtistDetailsPanel;
