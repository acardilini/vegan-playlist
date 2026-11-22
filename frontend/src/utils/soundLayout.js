// Pure layout for the song page's "The Sound" section: which audio rows sit in which column. No React, no DOM,
// so it runs under `node --test`. The rows themselves come ready-labelled from the API (services/audioAnalysis).

const LEFT = ['musical_mood', 'sonic_intensity', 'production_texture', 'dynamic_arc'];
const RIGHT = ['vocal_style', 'rhythmic_feel', 'instrumentation'];

// { left, right }: each an array of rows. A row is the API row ({key, label, description, values}) or the
// synthesised Tempo · Key row ({key:'tempo_key', label, text}). Rows with no values are dropped, so a song
// with no instruments (an a cappella track) simply has no Instruments row.
export function splitColumns(audio) {
  const rows = (audio && Array.isArray(audio.rows)) ? audio.rows.filter((r) => r && r.values && r.values.length > 0) : [];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const pick = (keys) => keys.map((k) => byKey.get(k)).filter(Boolean);

  const left = pick(LEFT);
  const right = pick(RIGHT);

  const parts = [];
  if (audio && audio.tempo_bpm != null) parts.push(`${audio.tempo_bpm} BPM`);
  if (audio && audio.key) parts.push(audio.key);
  if (parts.length) right.push({ key: 'tempo_key', label: 'Tempo · Key', text: parts.join(' · ') });

  return { left, right };
}

// Whether "The Sound" has anything to show: a summary or any row (tempo and key included). Sample clips are not part of it:
// they live in the "Through the song" timeline.
export function hasSoundContent(audio) {
  if (!audio) return false;
  const { left, right } = splitColumns(audio);
  return !!audio.summary || left.length > 0 || right.length > 0;
}
