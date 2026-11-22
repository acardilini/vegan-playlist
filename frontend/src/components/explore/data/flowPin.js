// Pinned selection on the Arguments flow: a pin holds only column positions and codes (never node objects), so it is
// independent of the preset's layout and is re-resolved against the current flow.
export const noun = n => (n === 1 ? 'song' : 'songs');

// Resolve a pinned selection against the CURRENT flow: { parts: [{col,key,other}], label, n } or null when the pin no
// longer exists (the slice changed under it). A pin holds only column positions and codes, never node objects.
export function resolvePin(flow, pin) {
  if (!pin || !flow.columns.length) return null;
  const nodeOf = (col, key) => (flow.columns[col] ? flow.columns[col].nodes.find(x => x.key === key) : undefined);
  if (pin.type === 'node') {
    const node = nodeOf(pin.col, pin.key);
    if (!node) return null;
    return { parts: [{ col: pin.col, key: node.key, other: node.other }], label: `${node.label} (${flow.columns[pin.col].name.toLowerCase()})`, n: node.n };
  }
  if (pin.type === 'ribbon') {
    const link = (flow.links[pin.fromCol] || []).find(l => l.from === pin.from && l.to === pin.to);
    const a = nodeOf(pin.fromCol, pin.from);
    const b = nodeOf(pin.fromCol + 1, pin.to);
    if (!link || !a || !b) return null;
    return {
      parts: [{ col: pin.fromCol, key: a.key, other: a.other }, { col: pin.fromCol + 1, key: b.key, other: b.other }],
      label: `${a.label} to ${b.label}`,
      n: link.n,
    };
  }
  if (pin.type === 'path') {
    const path = flow.paths.find(p => p.keys.join('\u0001') === pin.keys.join('\u0001'));
    if (!path) return null;
    return {
      parts: path.keys.map((key, col) => ({ col, key, other: !!nodeOf(col, key)?.other })),
      label: path.labels.join(' > '),
      n: path.n,
    };
  }
  return null;
}
