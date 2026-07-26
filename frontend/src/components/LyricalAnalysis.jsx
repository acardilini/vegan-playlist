import { useState } from 'react';
import { subDimensionColor } from '../styles/subDimensionPalette';
import InfoTip from './InfoTip';

// Right-hand "What it's about" dimensions: [data key, display heading].
const DIMENSIONS = [
  ['themes', 'Themes'],
  ['targets', 'Subjects'],
  ['actions', 'Actions'],
  ['tactics', 'Tactics'],
  ['moral_frames', 'Moral frames'],
];

function LyricalAnalysis({ analysis }) {
  const [showQuotes, setShowQuotes] = useState(false);
  if (!analysis) return null;

  const attributes = analysis.attributes || [];
  const emotions = analysis.emotions || [];
  const summary = (analysis.summary || '').trim();
  const acoustic = analysis.acoustic || [];
  const dims = DIMENSIONS
    .map(([key, heading]) => [key, heading, analysis[key] || []])
    .filter(([, , codes]) => codes.length > 0);

  const hasLyricStyle = attributes.length > 0 || emotions.length > 0;
  const hasSound = acoustic.length > 0;
  const hasStyle = hasLyricStyle || hasSound;
  const hasThemes = dims.length > 0;
  if (!hasStyle && !hasThemes && !summary) return null;

  const hasQuotes = dims.some(([, , codes]) => codes.some(c => c.evidence));

  return (
    <div className="lyrical-analysis">
      {summary && (
        <p className="la-summary">
          <span className="la-summary-label">In short</span>
          {summary}
        </p>
      )}

      <div className="la-sections">
        {hasStyle && (
          <section className="la-section">
            <h3 className="la-section-title">Style &amp; tone</h3>
            <p className="la-section-desc">The voice and mood of the lyrics, and how the recording sounds.</p>

            {hasLyricStyle && (
              <div className="la-group">
                <h4 className="la-group-title">In the lyrics</h4>
                <div className="la-attributes">
                  {attributes.map(a => (
                    <div key={a.label} className="la-attr">
                      <span className="la-attr-label">{a.label}</span>
                      <InfoTip text={a.definition}>
                        <span className="la-attr-value">{a.value}</span>
                      </InfoTip>
                    </div>
                  ))}
                  {emotions.length > 0 && (
                    <div className="la-attr la-attr-emotions">
                      <span className="la-attr-label">Emotions</span>
                      <span className="la-attr-value">{emotions.join('; ')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {hasSound && (
              <div className="la-group">
                <h4 className="la-group-title">In the sound</h4>
                <div className="la-attributes">
                  {acoustic.map(a => (
                    <div key={a.label} className="la-attr">
                      <span className="la-attr-label">{a.label}</span>
                      <InfoTip text={a.definition}>
                        <span className="la-attr-value">{a.value}</span>
                      </InfoTip>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {hasThemes && (
          <section className="la-section">
            <div className="la-section-head">
              <h3 className="la-section-title">What it&rsquo;s about</h3>
              {hasQuotes && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm la-quotes-toggle"
                  aria-expanded={showQuotes}
                  onClick={() => setShowQuotes(v => !v)}
                >
                  {showQuotes ? 'Hide quotes' : 'Show quotes'}
                </button>
              )}
            </div>
            <p className="la-section-desc">The ideas, subjects and calls to action in the lyrics.</p>

            {dims.map(([key, heading, codes]) => {
              const quoted = codes.filter(c => c.evidence);
              return (
                <div key={key} className="la-dimension">
                  <h4 className="la-dim-heading">{heading}</h4>
                  <div className="la-chips">
                    {codes.map((c, i) => (
                      <InfoTip key={`${c.code}-${i}`} text={c.definition}>
                        <span className="la-chip" style={{ borderColor: subDimensionColor(c.sub_dimension) }}>
                          <span className="la-chip-dot" style={{ backgroundColor: subDimensionColor(c.sub_dimension) }} />
                          {c.label}
                        </span>
                      </InfoTip>
                    ))}
                  </div>
                  {showQuotes && quoted.length > 0 && (
                    <ul className="la-quotes">
                      {quoted.map((c, i) => (
                        <li key={`${c.code}-${i}`}>
                          <span className="la-quote-tag">{c.label}</span>
                          <span className="la-quote-text">&ldquo;{c.evidence}&rdquo;</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

export default LyricalAnalysis;
