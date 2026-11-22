// Pure helpers for the story panels. No DOM, no React: node --test exercises them directly.

export const decadeLabel = (decade) => `${decade}s`;

const pctOf = (share) => Math.round(share * 100);

// Decade-bars chart -> one row per bar, in the order the story file lists them. `ghostPct` is where the same code stood
// in the previous decade (a tick on the bar); `deltaText` says the change in whole percentage points.
export function barRows(chart) {
  return chart.bars.map((b) => {
    const pct = pctOf(b.share);
    const ghostPct = b.previousShare == null ? null : pctOf(b.previousShare);
    let deltaText = null;
    if (ghostPct != null && chart.previousDecade != null) {
      const diff = pct - ghostPct;
      const since = `since the ${decadeLabel(chart.previousDecade)}`;
      deltaText = diff === 0 ? `no change ${since}` : `${diff > 0 ? '+' : '-'}${Math.abs(diff)} points ${since}`;
    }
    return { code: b.code, label: b.label, pct, ghostPct, deltaText };
  });
}

// The Table view of a chart panel: the same numbers, for checking and for screen readers.
export function chartTable(chart) {
  if (chart.variant === 'decade-lines') {
    return {
      head: ['Decade', 'Songs', ...chart.series.map((s) => s.label)],
      rows: chart.decades.map((d, i) => [
        decadeLabel(d.decade), d.n, ...chart.series.map((s) => (s.values[i] == null ? 'too few' : `${pctOf(s.values[i])}%`)),
      ]),
    };
  }
  const withPrev = chart.previousDecade != null;
  return {
    head: ['Category', decadeLabel(chart.decade), ...(withPrev ? [decadeLabel(chart.previousDecade)] : [])],
    rows: chart.bars.map((b) => [
      b.label, `${pctOf(b.share)}%`, ...(withPrev && b.previousShare != null ? [`${pctOf(b.previousShare)}%`] : []),
    ]),
  };
}

// Y domain for share lines: 0 to the largest plotted value rounded up to a multiple of 20%, so the four gridlines
// land on whole percentages. Never above 100%.
export function linesDomain(series) {
  const values = series.flatMap((s) => s.values.filter((v) => v != null));
  const top = Math.ceil((Math.max(0, ...values) * 5) - 1e-9) / 5;
  return [0, Math.min(1, Math.max(0.2, top))];
}

// One palette slot per code for the whole story, by first appearance, so a code is the same colour in every chart.
export function colourSlots(blocks) {
  const slots = new Map();
  for (const b of blocks) {
    if (b.type !== 'chart') continue;
    const codes = b.variant === 'decade-lines' ? b.series.map((s) => s.code) : b.bars.map((x) => x.code);
    for (const c of codes) if (!slots.has(c)) slots.set(c, slots.size);
  }
  return slots;
}

const PALETTE_SLOTS = 7; // --explore-cat-1..7, the validated categorical set
export function colourVar(slots, code) {
  return slots.has(code) ? `var(--explore-cat-${(slots.get(code) % PALETTE_SLOTS) + 1})` : 'var(--explore-not-coded)';
}
