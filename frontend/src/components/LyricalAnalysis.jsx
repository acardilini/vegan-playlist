import { useState } from 'react';
import { subDimensionColor } from '../styles/subDimensionPalette';
import InfoTip from './InfoTip';

// Dimension render order + display headings.
const DIMENSIONS = [
  ['themes', 'Themes'],
  ['targets', 'Targets'],
  ['actions', 'Actions'],
  ['tactics', 'Tactics'],
  ['moral_frames', 'Moral frames'],
];

// The per-dimension sub-dimension legend (swatch + label rows) was removed as clutter
// (curator, 2026-07-22). The chips keep their sub-dimension colour on border and dot, so
// the colour coding survives without a key above every dimension.

function LyricalAnalysis({ analysis }) {
  const [showEvidence, setShowEvidence] = useState(false);
  if (!analysis) return null;

  const attributes = analysis.attributes || [];
  const emotions = analysis.emotions || [];
  const dims = DIMENSIONS
    .map(([key, heading]) => [key, heading, analysis[key] || []])
    .filter(([, , codes]) => codes.length > 0);

  if (attributes.length === 0 && emotions.length === 0 && dims.length === 0) return null;

  const hasEvidence = !!analysis.explanation ||
    dims.some(([, , codes]) => codes.some(c => c.evidence));

  return (
    <div className="lyrical-analysis">
      {(attributes.length > 0 || emotions.length > 0) && (
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
      )}

      <div className="la-dimensions">
      {dims.map(([key, heading, codes]) => {
        return (
          <div key={key} className="la-dimension">
            <h4 className="la-dim-heading">{heading}</h4>
            <div className="la-chips">
              {codes.map((c, i) => (
                <InfoTip key={`${c.code}-${i}`} text={c.definition}>
                  <span
                    className="la-chip"
                    style={{ borderColor: subDimensionColor(c.sub_dimension) }}
                  >
                    <span className="la-chip-dot" style={{ backgroundColor: subDimensionColor(c.sub_dimension) }} />
                    {c.label}
                  </span>
                </InfoTip>
              ))}
            </div>
          </div>
        );
      })}
      </div>

      {hasEvidence && (
        <div className="la-evidence-wrap">
          <button
            type="button"
            className="btn btn-ghost btn-sm la-evidence-toggle"
            aria-expanded={showEvidence}
            onClick={() => setShowEvidence(v => !v)}
          >
            {showEvidence ? 'Hide evidence' : 'Show evidence'}
          </button>
          {showEvidence && (
            <div className="la-evidence">
              {analysis.explanation && (
                <div className="la-evidence-block">
                  <h5>Summary</h5>
                  <p>{analysis.explanation}</p>
                </div>
              )}
              {dims.map(([key, heading, codes]) => {
                const quoted = codes.filter(c => c.evidence);
                if (quoted.length === 0) return null;
                return (
                  <div key={key} className="la-evidence-block">
                    <h5>{heading}</h5>
                    <ul className="la-evidence-list">
                      {quoted.map((c, i) => (
                        <li key={`${c.code}-${i}`}>
                          <span className="la-evidence-tag">{c.label}</span>
                          <span className="la-evidence-quote">&ldquo;{c.evidence}&rdquo;</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LyricalAnalysis;
