// Duplicate-song detection. A pair is a candidate ONLY when the normalised
// title AND the normalised artist both match — the same conservative rule the
// 1.2/1.3 dedup used, so different bands sharing a song title are not flagged.

function normalizeText(text) {
  if (!text) return '';
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function titlesMatch(a, b) {
  const t1 = normalizeText(a), t2 = normalizeText(b);
  if (!t1 || !t2) return false;
  if (t1 === t2) return true;
  if (t1.includes(t2) || t2.includes(t1)) return true;
  const w1 = t1.split(' ').filter(w => w.length > 2);
  const w2 = t2.split(' ').filter(w => w.length > 2);
  if (!w1.length || !w2.length) return false;
  const common = w1.filter(w => w2.includes(w));
  return common.length / Math.max(w1.length, w2.length) >= 0.6;
}

function artistsMatch(a, b) {
  const a1 = normalizeText(a), a2 = normalizeText(b);
  if (!a1 || !a2) return false;
  return a1 === a2 || a1.includes(a2) || a2.includes(a1);
}

function isDuplicatePair(s1, s2) {
  return titlesMatch(s1.title, s2.title) && artistsMatch(s1.artists, s2.artists);
}

function findDuplicateGroups(songs) {
  const groups = [];
  const processed = new Set();
  for (let i = 0; i < songs.length; i++) {
    if (processed.has(songs[i].id)) continue;
    const dupes = [songs[i]];
    for (let j = i + 1; j < songs.length; j++) {
      if (processed.has(songs[j].id)) continue;
      if (isDuplicatePair(songs[i], songs[j])) { dupes.push(songs[j]); processed.add(songs[j].id); }
    }
    if (dupes.length > 1) {
      dupes.sort((a, b) => {
        if (a.created_at !== b.created_at) return new Date(a.created_at) - new Date(b.created_at);
        return (b.popularity || 0) - (a.popularity || 0);
      });
      groups.push({
        groupId: groups.length + 1,
        songs: dupes,
        confidence: dupes.length > 2 ? 'high' : 'medium',
        recommendedAction: `Keep "${dupes[0].title}" by ${dupes[0].artists} (oldest/most popular)`,
      });
    }
    processed.add(songs[i].id);
  }
  return groups;
}

module.exports = { normalizeText, titlesMatch, artistsMatch, isDuplicatePair, findDuplicateGroups };
