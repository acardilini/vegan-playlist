import { AutoText } from './SavedField';

const PARK_LABELS = { awaiting_community: 'Awaiting community', needs_transcription: 'Needs transcription', listened_unclear: 'Listened — unclear' };

function NotesPanel({ wb, savePanel, saveProcessing }) {
  const p = wb.processing || {};
  return (
    <section className="wb-panel">
      <h2>Notes</h2>
      <AutoText label="Status notes" initial={wb.status_notes} multiline rows={3}
        onSave={(v) => savePanel('details', { status_notes: v })} />
      <AutoText label="Processing note" initial={p.processing_note} multiline rows={3}
        onSave={(v) => saveProcessing({ processing_note: v })} />
      {(p.park_reason || p.snooze_until) && (
        <p className="admin-stub">
          {p.park_reason ? `Parked: ${PARK_LABELS[p.park_reason] || p.park_reason}. ` : ''}
          {p.snooze_until ? `Remind after ${String(p.snooze_until).slice(0, 10)}.` : ''}
        </p>
      )}
    </section>
  );
}
export default NotesPanel;
