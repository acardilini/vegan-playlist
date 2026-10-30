// Pure text for the public artist page's facts. The server sends only accepted, non-empty parts (or null), and every
// element here hides when it has nothing to say: no empty labels, no stray separators.
export function summaryLine(facts) {
  if (!facts) return null;
  const parts = [facts.country, facts.formed_year ? `Formed ${facts.formed_year}` : null, facts.active_label].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// Current members first (the server already orders them); `former` marks the rest.
export function memberList(facts) {
  const members = facts && Array.isArray(facts.members) ? facts.members : [];
  return [...members.filter((m) => m.is_current), ...members.filter((m) => !m.is_current)]
    .map((m) => ({ name: m.name, vegan: !!m.vegan, former: !m.is_current }));
}
