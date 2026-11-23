import { useState } from 'react';
import { SaveTag } from './SavedField';
import AudioTimeline from '../AudioTimeline';

// The song's audio analysis as the curator sees it, plus the one decision it needs: whether the sample moments
// (sound effects, sampled speech - some of them graphic) may appear on the public song page. The server withholds
// samples from the site until this is Show; here they are always listed so the curator can judge them.
const CHOICES = [
  { key: 'show', value: true, label: 'Show' },
  { key: 'hide', value: false, label: 'Hide' },
  { key: 'unreviewed', value: null, label: 'Not reviewed' },
];

const STATUS_NOTE = {
  UNAVAILABLE: 'The audio could not be reached (the video is unavailable).',
  TOO_LONG: 'The audio was too long to analyse.',
  ERROR: 'The analysis failed.',
  PENDING: 'The analysis has not run yet.',
};

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function SampleDecision({ audio, savePanel }) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const current = audio.show_audio_samples === undefined ? null : audio.show_audio_samples;

  const choose = async (value) => {
    if (value === current) return;
    setStatus('saving'); setError('');
    const res = await savePanel('audio-samples', { show: value });
    if (res && res.ok) setStatus('saved');
    else { setStatus('error'); setError((res && res.error) || 'Could not save'); }
  };

  return (
    <div className="wb-audio-decision">
      <span className="wb-field-label" id="wb-audio-samples-label">
        Samples on the site <SaveTag status={status} />
      </span>
      <div className="wb-audio-choices" role="radiogroup" aria-labelledby="wb-audio-samples-label">
        {CHOICES.map((c) => (
          <button key={c.key} type="button" role="radio" aria-checked={current === c.value}
            className={`btn btn-sm ${current === c.value ? 'btn-primary' : 'btn-secondary'}`}
            disabled={status === 'saving'}
            onClick={() => choose(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="wb-audio-hint">
        {current === true && 'Visitors see the sample list on this song.'}
        {current === false && 'Reviewed and kept off the site.'}
        {current === null && 'Hidden from visitors until you choose Show. This song is in Needs sample approval.'}
      </div>
      {error && <div className="wb-genre-opt-error" role="alert">{error}</div>}
    </div>
  );
}

// The curator names (or clears) the source of one quoted sample. Saves go to the web-owned song_sample_sources, never to
// the analysis; the server matches the sample by its type + timestamp. `suggested` is the analysis' lower-confidence guess
// (admin only), shown as a hint and never saved unless the curator types it.
function SourceEditor({ item, savePanel }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const key = { type: item.type, timestamp: item.timestamp };

  const send = async (source) => {
    setStatus('saving'); setError('');
    const res = await savePanel('sample-source', { ...key, source });
    if (res && res.ok) { setStatus('saved'); setOpen(false); } else { setStatus('error'); setError((res && res.error) || 'Could not save'); }
  };

  return (
    <div className="wb-audio-source">
      {item.suggested && !item.confirmed && <div className="wb-audio-hint">AI guessed: {item.suggested}</div>}
      {!open && (
        <button type="button" className="btn btn-ghost btn-sm"
          onClick={() => { setText(item.confirmed ? item.source : ''); setOpen(true); setStatus('idle'); }}>
          {item.confirmed ? 'Edit source' : 'Add source'}
        </button>
      )}
      {open && (
        <div className="wb-audio-source-edit">
          <label className="wb-field-label">
            Source of this sample
            <input type="text" className="wb-audio-source-input" maxLength={200} value={text}
              onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="wb-audio-source-actions">
            <button type="button" className="btn btn-primary btn-sm" disabled={status === 'saving' || !text.trim()}
              onClick={() => send(text)}>Save</button>
            {item.confirmed && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={status === 'saving'}
                onClick={() => send('')}>Clear</button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" disabled={status === 'saving'}
              onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      <SaveTag status={status} error={error} />
    </div>
  );
}

// Saved sources that no longer match any sample (the analysis was re-run and the timestamp moved). Never public.
function OrphanSources({ orphans, savePanel }) {
  if (!orphans || orphans.length === 0) return null;
  return (
    <div className="wb-audio-orphans">
      <div className="wb-audio-hint">Saved sources that no longer match a sample:</div>
      <ul>
        {orphans.map((o) => (
          <li key={`${o.type}-${o.timestamp}`}>
            <span className="wb-audio-sample-time">{o.timestamp}</span> {o.type} &mdash; {o.source}{' '}
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => savePanel('sample-source', { type: o.type, timestamp: o.timestamp, source: '' })}>
              Clear
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SampleList({ samples, savePanel }) {
  const items = samples.items || [];
  return (
    <div className="wb-audio-samples">
      <div className="wb-genre-options-title">
        Samples found: {samples.types.map((t) => t.label).join(', ')}
      </div>
      {items.length === 0
        ? <p className="admin-stub">The analysis named the sample types but gave no moment-by-moment details.</p>
        : (
          <ul className="wb-audio-sample-list">
            {items.map((it, i) => (
              <li key={`${it.type}-${it.timestamp || i}`}>
                <div className="wb-audio-sample-head">
                  <span className="wb-audio-sample-type">{it.label}</span>
                  {it.timestamp && <span className="wb-audio-sample-time">{it.timestamp}</span>}
                </div>
                {!it.transcript && it.description && <p>{it.description}</p>}
                {it.transcript && <p className="wb-audio-transcript">&ldquo;{it.transcript}&rdquo;</p>}
                {it.source
                  ? <div className="wb-audio-by">&mdash; {it.source}</div>
                  : it.transcript && <div className="wb-audio-by wb-audio-by-unknown">Unidentified source</div>}
                {it.transcript && it.timestamp && <SourceEditor item={it} savePanel={savePanel} />}
              </li>
            ))}
          </ul>
        )}
      <OrphanSources orphans={samples.orphans} savePanel={savePanel} />
    </div>
  );
}

function AudioPanel({ wb, savePanel }) {
  const audio = wb.audio;
  if (!audio) {
    return (
      <section className="wb-panel">
        <h2>Audio</h2>
        <p className="admin-stub">No audio analysis for this song</p>
      </section>
    );
  }

  const usable = audio.status === 'OK';
  const date = fmtDate(audio.analyzed_at);
  const measured = [
    audio.tempo_bpm != null ? `Tempo ${audio.tempo_bpm} BPM` : null,
    audio.key ? `Key ${audio.key}` : null,
    audio.loudness_lufs != null ? `Loudness ${Number(audio.loudness_lufs).toFixed(1)} LUFS` : null,
  ].filter(Boolean);

  return (
    <section className="wb-panel">
      <h2>Audio</h2>
      <div className="wb-audio-status">
        {usable
          ? `Analysed${audio.model ? ` by ${audio.model}` : ''}${date ? ` on ${date}` : ''}`
          : `Analysis status: ${audio.status}${audio.model ? ` (${audio.model})` : ''}`}
      </div>
      {!usable && <p className="admin-stub">{STATUS_NOTE[audio.status] || 'No usable analysis.'}</p>}
      {usable && (
        <>
          {audio.summary && <p className="wb-audio-summary">{audio.summary}</p>}
          <dl className="wb-audio-rows">
            {audio.rows.map((r) => (
              <div key={r.key} className="wb-audio-row">
                <dt>{r.label}</dt>
                <dd>{r.values.map((v) => v.label).join(', ')}</dd>
              </div>
            ))}
          </dl>
          {measured.length > 0 && <div className="wb-audio-measured">{measured.join(' · ')}</div>}
          {/* The curator's view of the timeline, with every sample clip whatever the gate says, to judge before approving. */}
          <AudioTimeline audio={audio} />
          {audio.samples
            ? (
              <>
                <SampleList samples={audio.samples} savePanel={savePanel} />
                <SampleDecision audio={audio} savePanel={savePanel} />
              </>
            )
            : <p className="admin-stub">No audio samples detected</p>}
        </>
      )}
    </section>
  );
}
export default AudioPanel;
