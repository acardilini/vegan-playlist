import { useState } from 'react';
import InfoTip from './InfoTip';

// Right-hand "What it's about" dimensions: [data key, display heading].
const DIMENSIONS = [
  ['themes', 'Themes'],
  ['targets', 'Subjects'],
  ['actions', 'Actions & advocacy'],
  ['moral_frames', 'Moral frames'],
];

// Helper to determine synthesized "Lvl of Animal Focus"
function getAnimalFocusLevel(focus, clarity) {
  if (!focus && !clarity) return null;
  const f = (focus || '').toUpperCase();
  const c = (clarity || '').toUpperCase();
  if (f === 'PRIMARY' && c === 'EXPLICIT') return { label: 'Central (Explicit)', desc: 'The song is entirely centered on animal liberation / slaughter and names it directly.' };
  if (f === 'PRIMARY' && c === 'ALLEGORICAL') return { label: 'Central (Allegorical)', desc: 'The entire song is about animal liberation, told through metaphor, role reversal, or allegory.' };
  if (f === 'PRIMARY') return { label: 'Central (Narrative)', desc: 'The entire song is about animal suffering or diet, told through descriptive storytelling.' };
  if (f === 'SECONDARY') return { label: 'Major Theme / Co-equal', desc: 'Features a dedicated verse or major theme alongside other social/political issues.' };
  if (f === 'PERIPHERAL') return { label: 'Passing Mention', desc: 'A brief 1–2 line mention or list item in a song primarily about another topic.' };
  if (f === 'MINOR_MENTION' || c === 'ABSENT') return { label: 'Incidental Reference', desc: 'An incidental idiom or background reference without substantive vegan thesis.' };
  return { label: f || 'General Focus', desc: '' };
}

// Codes grouped by sub-dimension, in order of first appearance, so each group can carry a caption.
function bySubDimension(codes) {
  const groups = new Map();
  for (const c of codes) {
    const key = c.sub_dimension || '';
    if (!groups.has(key)) groups.set(key, { key, label: c.sub_dimension_label || '', codes: [] });
    groups.get(key).codes.push(c);
  }
  return [...groups.values()];
}

function LyricalAnalysis({ analysis }) {
  const [showQuotes, setShowQuotes] = useState(false);
  if (!analysis) return null;

  const rawAttributes = analysis.attributes || [];
  // Exclude Clarity, Focus, and Intensity from "Style & tone > In the lyrics"
  const attributes = rawAttributes.filter(a => a.label !== 'Clarity' && a.label !== 'Focus' && a.label !== 'Intensity');

  const animalFocus = getAnimalFocusLevel(analysis.focus_amount, analysis.clarity);
  const emotions = analysis.emotions || [];
  const summary = (analysis.summary || '').trim();
  const acoustic = analysis.acoustic || [];
  const dims = DIMENSIONS
    .map(([key, heading]) => [key, heading, analysis[key] || []])
    .filter(([, , codes]) => codes.length > 0);

  const hasLyricStyle = attributes.length > 0 || emotions.length > 0;
  const hasSound = acoustic.length > 0;
  const hasStyle = hasLyricStyle || hasSound;
  const hasThemes = dims.length > 0 || !!animalFocus;
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
            <p className="la-section-desc">The ideas, subjects, and calls to action in the lyrics.</p>

            {animalFocus && (
              <div className="la-dimension" style={{ marginBottom: '1.25rem' }}>
                <h4 className="la-dim-heading">Lvl of Animal Focus</h4>
                <div className="la-terms" style={{ marginTop: '0.25rem' }}>
                  <InfoTip text={animalFocus.desc}>
                    <span className="la-term" style={{ fontWeight: 600 }}>{animalFocus.label}</span>
                  </InfoTip>
                </div>
              </div>
            )}

            {dims.map(([key, heading, codes]) => {
              const quoted = codes.filter(c => c.evidence);
              return (
                <div key={key} className="la-dimension">
                  <h4 className="la-dim-heading">{heading}</h4>
                  {bySubDimension(codes).map((g) => (
                    <div key={g.key} className="la-subdim">
                      {g.label && <div className="la-subdim-caption">{g.label}</div>}
                      <p className="la-terms">
                        {g.codes.map((c, i) => (
                          <span key={`${c.code}-${i}`}>
                            {i > 0 && <span className="la-terms-sep" aria-hidden="true">·</span>}
                            <InfoTip text={c.definition}>
                              <span className="la-term">{c.label}</span>
                            </InfoTip>
                          </span>
                        ))}
                      </p>
                    </div>
                  ))}
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
      </div>
    </div>
  );
}

export default LyricalAnalysis;
