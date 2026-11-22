import { useEffect, useState } from 'react';
import { SaveTag } from './SavedField';

// What songs.lyrics_source says about text that began as an AI draft and was checked by the curator (VARCHAR(50)).
export const DRAFT_LYRICS_SOURCE = 'AI transcript, curator-checked';

// The analysis project listened to this song's audio (a spoken-word or advocate-speech track with no lyrics) and wrote
// a draft transcript. It is NOT lyrics until the curator has listened, corrected it and saved it here, which goes
// through the same lyrics save as typing them in. Until then it is shown only in this admin panel.
function DraftTranscript({ draft, savePanel }) {
  const [text, setText] = useState(draft.transcript);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  useEffect(() => { setText(draft.transcript); setStatus('idle'); }, [draft.transcript, draft.youtube_id]);

  const save = async () => {
    if (!text.trim()) return;
    setStatus('saving'); setError('');
    const res = await savePanel('lyrics', { lyrics: text, lyrics_source: DRAFT_LYRICS_SOURCE });
    if (res && res.ok) setStatus('saved');   // the draft retires itself: the song now has lyrics
    else { setStatus('error'); setError((res && res.error) || 'Could not save'); }
  };

  const meta = [
    draft.word_count != null ? `${draft.word_count} words` : null,
    draft.languages.length ? draft.languages.join(', ') : null,
    draft.confidence ? `${draft.confidence.toLowerCase()} confidence` : null,
    draft.model_used,
  ].filter(Boolean).join(' · ');

  return (
    <div className="wb-draft">
      <div className="wb-genre-options-title">AI draft transcript (not lyrics yet)</div>
      <div className="wb-draft-meta">
        {meta}
        {draft.youtube_id && (
          <> · <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(draft.youtube_id)}`} target="_blank" rel="noreferrer">Listen to check</a></>
        )}
      </div>
      <textarea className="input wb-mono" rows={12} value={text} aria-label="Draft transcript" style={{ width: '100%' }}
        onChange={(e) => { setText(e.target.value); if (status !== 'idle') setStatus('idle'); }} />
      <div className="wb-draft-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={status === 'saving' || !text.trim()} onClick={save}>
          Save as lyrics
        </button>
        <span className="section-note">Correct it against the audio first. Saving makes it this song&rsquo;s lyrics (source: {DRAFT_LYRICS_SOURCE}).</span>
        <SaveTag status={status} error={error} />
      </div>
    </div>
  );
}
export default DraftTranscript;
