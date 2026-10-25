import IdentifyPanel from './IdentifyPanel';
import { AutoText } from './SavedField';

// Links = the three Band check identities (one writer: /band-check/.../identity) + the public Website.
// `focus` = { open, n } lets the Catalogue panel ask for a specific source row; n re-keys the panel.
function ArtistLinksPanel({ artist, save, focus, onIdentitySaved }) {
  const identity = { spotify: artist.spotify_id || null, bandcamp: artist.bandcamp_url || null, musicbrainz: artist.musicbrainz_id || null };
  return (
    <section className="wb-panel">
      <h2>Links</h2>
      <IdentifyPanel key={focus.n} artistId={artist.id} name={artist.name} identity={identity}
        initialOpen={focus.open} onSaved={onIdentitySaved} />
      <AutoText label="Website" placeholder="https://" initial={artist.website_url}
        onSave={(v) => save({ website_url: v })} />
    </section>
  );
}
export default ArtistLinksPanel;
