import InfoTip from './InfoTip';
import { splitColumns, sampleHeading, hasSoundContent } from '../utils/soundLayout';

// The song page's "The Sound": the right-hand half of Song analysis, the counterpart of "The Lyrics". A summary,
// then one card of rows (Mood / Intensity / Production / Dynamics, then Vocals / Rhythm / Instruments / Tempo · Key).
// The sample moments sit in a fold and only exist in the payload when the curator approved them, so this component
// has no gate of its own: it shows whatever the server sent.
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

function Samples({ samples }) {
  const items = samples.items || [];
  return (
    <details className="sound-samples">
      <summary>{sampleHeading(samples)}</summary>
      <p className="sound-samples-types">{samples.types.map((t) => t.label).join(', ')}</p>
      {items.length > 0 && (
        <ul className="sound-sample-list">
          {items.map((it, i) => (
            <li key={`${it.type}-${it.timestamp || i}`}>
              <div className="sound-sample-head">
                <span className="la-quote-tag">{it.label}</span>
                {it.timestamp && <span className="sound-sample-time">{it.timestamp}</span>}
              </div>
              {it.description && <p>{it.description}</p>}
              {it.transcript && <p className="sound-sample-transcript">&ldquo;{it.transcript}&rdquo;</p>}
              {it.source && <p className="sound-sample-source">{it.source}</p>}
            </li>
          ))}
        </ul>
      )}
    </details>
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
      {audio.samples && <Samples samples={audio.samples} />}
    </section>
  );
}

export default TheSound;
