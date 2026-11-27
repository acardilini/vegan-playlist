import IdentifyPanel from './IdentifyPanel';
import MatchStep from './MatchStep';
import { AutoText } from './SavedField';
import { identityStatus } from '../../utils/workbenchView';

// Section 1 of the artist page: the three identity links (Spotify, MusicBrainz, Bandcamp), the proposed MusicBrainz match
// under its row, the band's website, and the way into Merge. `enr` is the shared enrichment review; `focus` = { open, n }
// lets the Catalogue tab or the banner ask for a specific source row to be open (n re-keys the panel).
function IdentitySection({ artist, enr, save, focus, onIdentitySaved, onMerge }) {
  const identity = { spotify: artist.spotify_id || null, bandcamp: artist.bandcamp_url || null, musicbrainz: artist.musicbrainz_id || null };
  const status = identityStatus(identity, enr.review);
  return (
    <section className="aw-section" aria-labelledby="aw-sec-identity">
      <div className="aw-section-head">
        <span id="aw-sec-identity">1 · Identity and links</span>
        <span className={`adm-pill is-${status.tone}`}>{status.label}</span>
      </div>
      <div className="aw-section-body">
        <IdentifyPanel key={focus.n} artistId={artist.id} name={artist.name} identity={identity}
          initialOpen={focus.open} onSaved={onIdentitySaved}
          renderAfterRow={(source) => (source === 'musicbrainz' ? <MatchStep artist={artist} enr={enr} /> : null)} />
        <ul className="adm-list">
          <li className="adm-row">
            <span className="adm-col-label">Website</span>
            <AutoText label="Website" placeholder="https://" initial={artist.website_url} onSave={(v) => save({ website_url: v })} inline />
          </li>
        </ul>
        <div className="adm-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => onMerge(null)}>Merge with another artist...</button>
        </div>
      </div>
    </section>
  );
}
export default IdentitySection;
