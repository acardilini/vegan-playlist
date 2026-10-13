// Spotify source for the Band check. Reads only (client credentials). Errors are coded, never raw.
const { getSpotifyClient, withRetry } = require('../../utils/playlistSync');
const { mapTrack } = require('../staging');
const { creditsArtist } = require('./merge');
const { sourceError } = require('./errors');

const PAGE = 50;

function createSpotifyAdapter({ getApi = getSpotifyClient, retry = withRetry } = {}) {
  const call = (fn) => retry(fn, { maxWaitS: 30, maxRetries: 3 });

  async function pageAll(fetchPage) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const items = await fetchPage(PAGE, offset);
      out.push(...items);
      if (items.length < PAGE) return out;
    }
  }

  async function identify(query) {
    try {
      const api = await getApi();
      const res = await call(() => api.searchArtists(query, { limit: 8 }));
      return res.body.artists.items.map(a => ({
        value: a.id,
        label: a.name,
        detail: [`${(a.followers && a.followers.total || 0).toLocaleString('en-US')} followers`, (a.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '),
        url: (a.external_urls && a.external_urls.spotify) || null,
      }));
    } catch (e) { throw sourceError(e); }
  }

  async function fetchCatalogue(spotifyId) {
    try {
      const api = await getApi();
      const albums = await pageAll((limit, offset) => call(() =>
        api.getArtistAlbums(spotifyId, { include_groups: 'album,single,compilation,appears_on', limit, offset })).then(r => r.body.items));
      const releases = [];
      for (const alb of albums) {
        const tracks = await pageAll((limit, offset) => call(() => api.getAlbumTracks(alb.id, { limit, offset })).then(r => r.body.items));
        const credited = tracks.filter(t => creditsArtist(t, spotifyId));
        if (credited.length === 0) continue; // an "appears on" release that does not credit the band
        releases.push({
          id: alb.id, name: alb.name, album_type: alb.album_type || null, release_date: alb.release_date || null,
          url: (alb.external_urls && alb.external_urls.spotify) || null,
          tracks: credited.map(t => ({
            title: t.name, id: t.id, url: (t.external_urls && t.external_urls.spotify) || null,
            mapped: mapTrack({ ...t, album: alb }),
          })),
        });
      }
      return { source: 'spotify', releases };
    } catch (e) { throw sourceError(e); }
  }

  return { source: 'spotify', identify, fetchCatalogue };
}

module.exports = { createSpotifyAdapter };
