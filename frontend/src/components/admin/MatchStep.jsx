import { useState } from 'react';
import { sourceLink } from '../../utils/factSources';
import { methodLabel, confidenceLabel, stateLabel, spotifyArtistLink, albumLine } from '../../utils/enrichmentText';

const UNDECIDED = new Set(['pretrusted', 'needs-approval']);

// The proposed MusicBrainz match under the MusicBrainz row of section 1: what was proposed and how, the evidence to check
// it (the artist's own catalogue and links), and Approve / Reject / Undo. The server re-reads everything; this only names
// the decision. Serious problems (a shared or wrong id) are in the banner; their warning lines are repeated here too.
function MatchStep({ artist, enr }) {
  const [unsure, setUnsure] = useState(false);
  const { review, busy, decide } = enr;
  if (!review || !review.has_proposal || review.match.state === 'none') return null;
  const { match, warnings } = review;
  const pending = UNDECIDED.has(match.state);
  const canUndo = match.state === 'rejected'; // an approval is the stored id, changed or cleared in the rows above
  const otherStored = match.stored_mbid && match.proposed_mbid && match.stored_mbid !== match.proposed_mbid;
  const spotify = spotifyArtistLink(artist.spotify_id);
  const bandcamp = sourceLink('Bandcamp', artist);
  const albums = albumLine(match.catalogue.albums);
  return (
    <div className="aw-match">
      {enr.error && enr.errorScope === 'match' && <div className="admin-message error">{enr.error}</div>}
      <div><strong>{stateLabel(match.state)}</strong></div>
      <div className="band-meta">
        {methodLabel(match.method)}{match.confidence && ` · ${confidenceLabel(match.confidence)}`}
        {match.url && <>{' · '}<a href={match.url} target="_blank" rel="noopener noreferrer">Check on MusicBrainz</a></>}
      </div>
      <div className="band-meta">
        {match.catalogue.songs} songs · {match.catalogue.live_songs} live
        {spotify && <>{' · '}<a href={spotify} target="_blank" rel="noopener noreferrer">Spotify</a></>}
        {bandcamp && <>{' · '}<a href={bandcamp} target="_blank" rel="noopener noreferrer">Bandcamp</a></>}
      </div>
      {albums && <div className="band-meta enr-value">{albums}</div>}
      {otherStored && <div className="enr-warn">Saved id {match.stored_mbid} differs from the proposed one - change or clear it in the rows above</div>}
      {warnings.filter((w) => w.field === 'match').map((w, i) => <div key={i} className="enr-warn">{w.text}</div>)}
      {pending && !unsure && (
        <div className="adm-actions">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide('approve')}>Approve match</button>
          {match.state === 'needs-approval' && (
            <>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decide('reject')}>Reject match</button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setUnsure(true)}>Not sure</button>
            </>
          )}
        </div>
      )}
      {pending && unsure && (
        <div className="adm-actions">
          <span className="band-meta">Left undecided</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setUnsure(false)}>Decide now</button>
        </div>
      )}
      {canUndo && (
        <div className="adm-actions"><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide('clear')}>Undo decision</button></div>
      )}
    </div>
  );
}
export default MatchStep;
