import InfoTip from './InfoTip';
import { splitColumns, sampleHeading } from '../utils/soundLayout';

// The song page's "The Sound" section: what the audio analysis heard. A summary, then two columns of rows
// (Mood / Intensity / Production / Dynamics, then Vocals / Rhythm / Instruments / Tempo · Key). The sample
// moments sit in a fold and only exist in the payload when the curator approved them, so this component has
// no gate of its own: it shows whatever the server sent.
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

function Column({ rows }) {
  if (rows.length === 0) return null;
  return <div className="la-rows">{rows.map((r) => <Row key={r.key} row={r} />)}</div>;
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
  if (!audio) return null;
  const { left, right } = splitColumns(audio);
  const hasRows = left.length > 0 || right.length > 0;
  if (!audio.summary && !hasRows && !audio.samples) return null;

  return (
    <section className="la-section la-section-sound">
      <h3 className="la-section-title">The Sound</h3>
      {audio.summary && (
        <p className="la-summary sound-summary">
          <span className="la-summary-label">Sound summary</span>
          {audio.summary}
        </p>
      )}
      {hasRows && (
        <div className="sound-columns">
          <Column rows={left} />
          <Column rows={right} />
        </div>
      )}
      {audio.samples && <Samples samples={audio.samples} />}
    </section>
  );
}

export default TheSound;
