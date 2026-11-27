// Pure display text for the Check transcripts rail and the draft panel. The server sends a tier (HIGH / MEDIUM / LOW /
// UNINTELLIGIBLE) plus optional detail fields; any field may be null (older rows), and a null never prints.
// Lookups go through Map so a key like 'constructor' can never resolve to an inherited function.

const TONES = new Map([['HIGH', 'good'], ['MEDIUM', 'mid']]);
const CLARITY = new Map([
  ['CLEAR', 'Clear'],
  ['MODERATE', 'Moderate'],
  ['MUDDY_OR_BURIED', 'Muddy / Buried'],
  ['EXTREME_UNINTELLIGIBLE', 'Extreme / Unintelligible'],
]);

export const TIER_OPTIONS = [['', 'All'], ['HIGH', 'High'], ['MEDIUM', 'Medium'], ['LOW', 'Low'], ['UNINTELLIGIBLE', 'Unintelligible']];
export const SORT_OPTIONS = [['best', 'Highest confidence first'], ['worst', 'Lowest confidence first']];

const has = (v) => v !== null && v !== undefined;

export function badgeText({ tier, confidence_score }) {
  const t = has(tier) ? String(tier) : '';
  return has(confidence_score) && t ? `${t} · ${confidence_score}/100` : t;
}

// The rail shows only this: the score (or the tier when the row is unscored), coloured by tone.
export function scoreText({ tier, confidence_score }) {
  if (has(confidence_score)) return String(confidence_score);
  return has(tier) ? String(tier) : '';
}

// Everything else, for the rail badge's tooltip.
export function detailText(t) {
  return [badgeText(t), ...pillTexts(t)].filter(Boolean).join(' · ');
}

export function toneOf(tier) {
  return TONES.get(tier) || 'low';
}

export function clarityLabel(code) {
  return CLARITY.get(code) || null;
}

export function pillTexts({ audio_clarity, estimated_word_accuracy_pct, inaudible_segments }) {
  const out = [];
  const clarity = clarityLabel(audio_clarity);
  if (clarity) out.push(clarity);
  if (has(estimated_word_accuracy_pct)) out.push(`~${estimated_word_accuracy_pct}% words`);
  if (has(inaudible_segments) && inaudible_segments > 0) out.push(`${inaudible_segments} [inaudible]`);
  return out;
}
