// Nearest songs on the map, measured in the map's OWN coordinates (the raw 2D layout, or the
// normalised 3D cloud) - deliberately not embedding similarity, so what the viewer sees joined
// by a line or visited by the walk is what actually sits close together on screen.
// Pure: no React, no DOM. The song page's "You might also like" is unrelated and untouched.

function coordsOf(song, space, dim) {
  const c = dim === '3d' ? song.coords3 && song.coords3[space] : song.coords && song.coords[space];
  return Array.isArray(c) ? c : null;
}

export function nearestSongs(songs, targetId, space, dim, k, exclude = new Set()) {
  if (k <= 0) return [];
  const target = songs.find(s => s.id === targetId);
  const t = target && coordsOf(target, space, dim);
  if (!t) return [];
  const n = dim === '3d' ? 3 : 2;
  const found = [];
  for (const s of songs) {
    if (s.id === targetId || exclude.has(s.id)) continue;
    const c = coordsOf(s, space, dim);
    if (!c) continue;
    let d2 = 0;
    for (let i = 0; i < n; i++) d2 += (c[i] - t[i]) * (c[i] - t[i]);
    found.push({ id: s.id, dist: Math.sqrt(d2) });
  }
  found.sort((a, b) => a.dist - b.dist || a.id - b.id);
  return found.slice(0, k);
}
