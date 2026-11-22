import InfoTip from './InfoTip';
import { splitColumns, hasSoundContent } from '../utils/soundLayout';

// The song page's "The Sound": the right-hand half of Song analysis, the counterpart of "The Lyrics". A summary,
// then one card of rows (Mood / Intensity / Production / Dynamics, then Vocals / Rhythm / Instruments / Tempo · Key).
// Sampled speech and sound clips are not here: they are shown in the "Through the song" timeline.
function Row({ row }) {
  return (
    <div className="la-row">
      <span className="la-attr-label">{row.label}</span>
      <span className="la-attr-value">
        {row.values
          ? row.values.map((v, i) => (
              <span key={`${v.code}-${i}`}>
                {i > 0 && '; '}
                <InfoTip text={v.definition}>{v.label}</InfoTip>
              </span>
            ))
          : <InfoTip text="Estimated by software, so treat it as a guide.">{row.text}</InfoTip>}
      </span>
    </div>
  );
}

function TheSound({ audio }) {
  if (!hasSoundContent(audio)) return null;
  const { left, right } = splitColumns(audio);
  const rows = [...left, ...right];

  return (
    <section className="la-major la-major-sound">
      <h3 className="la-major-title">The Sound</h3>
      {audio.summary && (
        <p className="la-summary sound-summary">
          <span className="la-summary-label">In short</span>
          {audio.summary}
        </p>
      )}
      {rows.length > 0 && (
        <div className="la-rows">{rows.map((r) => <Row key={r.key} row={r} />)}</div>
      )}
    </section>
  );
}

export default TheSound;
