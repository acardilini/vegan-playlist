// Pure text for the public artist page's facts. The server sends only accepted, non-empty parts (or null), and every
// element here hides when it has nothing to say: no empty labels, no stray separators.
// The range of published work: both years -> "Released 1996–2024" (one year if equal), one year -> says which. A first year
// later than the last cannot be a range, so only the last release is kept.
function releaseRange(first, last) {
  if (first && last && first > last) first = null;
  if (first && last) return first === last ? `Released ${first}` : `Released ${first}–${last}`;
  if (last) return `Last release ${last}`;
  if (first) return `First release ${first}`;
  return null;
}

export function summaryLine(facts) {
  if (!facts) return null;
  const parts = [facts.country, facts.formed_year ? `Formed ${facts.formed_year}` : null, releaseRange(facts.first_release_year, facts.last_release_year)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// Current members first (the server already orders them); `former` marks the rest.
export function memberList(facts) {
  const members = facts && Array.isArray(facts.members) ? facts.members : [];
  return [...members.filter((m) => m.is_current), ...members.filter((m) => !m.is_current)]
    .map((m) => ({ name: m.name, vegan: !!m.vegan, former: !m.is_current }));
}
