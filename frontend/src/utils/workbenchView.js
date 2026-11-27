// Pure helpers for the artist workbench shell: the tab and the merge link live in the URL, the banner lists the serious
// identity problems, and section 1 gets one status. No DOM here, so node --test covers it.
const TABS = new Set(['details', 'catalogue']);
const UNDECIDED = new Set(['pretrusted', 'needs-approval']);

const params = (search) => new URLSearchParams(typeof search === 'string' ? search : '');
const toSearch = (p) => { const s = p.toString(); return s ? `?${s}` : ''; };

export function tabFromSearch(search) {
  const t = params(search).get('tab');
  return t === 'catalogue' ? 'catalogue' : 'details';
}

// 'catalogue' sets ?tab=catalogue; 'details' (or anything unknown) removes it. Other params are kept.
export function searchWithTab(search, tab) {
  const p = params(search);
  if (TABS.has(tab) && tab === 'catalogue') p.set('tab', 'catalogue'); else p.delete('tab');
  return toSearch(p);
}

// The artist named by ?mergeWith=: a positive safe integer other than this artist, else null.
export function mergeWithFromSearch(search, selfId) {
  const raw = params(search).get('mergeWith');
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 && n !== selfId ? n : null;
}

export function searchWithoutMergeWith(search) {
  const p = params(search);
  p.delete('mergeWith');
  return toSearch(p);
}

const songsText = (n) => `${n} ${n === 1 ? 'song' : 'songs'}`;

// Serious identity problems for the red "Needs you" banner: one line per artist sharing the MusicBrainz id, then the
// verdict that the proposed id belongs to a different act. Lesser findings stay on their own rows.
export function bannerItems(review) {
  if (!review || !review.has_proposal || !review.match) return [];
  const items = [];
  for (const s of review.match.shared_with || []) {
    items.push({
      key: `shared:${s.id}`, kind: 'shared', otherId: s.id, actionLabel: 'Review merge',
      text: `Another artist uses the same MusicBrainz id: ${s.name} (${songsText(s.songs)})`,
    });
  }
  if (review.match.wrong_identity) {
    items.push({
      key: 'wrong', kind: 'wrong', actionLabel: 'Check match',
      text: 'A later check found this MusicBrainz id belongs to a different act',
    });
  }
  return items;
}

// Section 1's pill: unset identity links, plus a match still waiting for the curator.
export function identityStatus(identity, review) {
  let n = ['spotify', 'bandcamp', 'musicbrainz'].filter((k) => !(identity && identity[k])).length;
  if (review && review.has_proposal && review.match && UNDECIDED.has(review.match.state)) n += 1;
  return n === 0 ? { label: 'done', tone: 'ok' } : { label: `${n} to check`, tone: 'todo' };
}
