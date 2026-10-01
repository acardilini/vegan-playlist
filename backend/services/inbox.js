// Submissions Inbox (sub-project C): community suggestions awaiting a curator decision.
// Functions take `db` (pool or client) first, like services/curation.js.
const staging = require('./staging');

function coded(code, message) { const e = new Error(message); e.code = code; return e; }

// Oldest first (FIFO). A catalogue match is flagged, not hidden; `live` says whether
// the matched song is on the public site.
async function listInbox(db) {
  const r = await db.query(`
    SELECT ss.id, ss.song_title, ss.artist_name, ss.album_name, ss.release_year, ss.youtube_url,
           ss.lyrics_excerpt, ss.submission_reason, ss.submitter_name, ss.submitter_email, ss.created_at,
           s.id AS match_id, s.title AS match_title,
           (s.status = 'included' AND s.published = true) AS match_live
    FROM song_submissions ss
    LEFT JOIN songs s ON s.id = ss.existing_song_id
    WHERE ss.status = 'pending'
    ORDER BY ss.created_at ASC, ss.id ASC`);
  return r.rows.map(({ match_id, match_title, match_live, ...row }) => ({
    ...row,
    match: match_id ? { song_id: match_id, title: match_title, live: match_live } : null,
  }));
}

async function assertPending(db, id) {
  const cur = (await db.query('SELECT status FROM song_submissions WHERE id=$1', [id])).rows[0];
  if (!cur) throw coded('NOT_FOUND', 'submission not found');
  if (cur.status !== 'pending') throw coded('NOT_PENDING', `submission is already ${cur.status}`);
}

// Claim first, then bridge: the row is flipped to 'approved' (and its catalogue match cleared, so the
// bridge treats it as a fresh suggestion) BEFORE anything is created, so a concurrent accept or
// dismiss gets NOT_PENDING without creating a song. If the bridge fails or yields no song, the claim
// is reverted and the row is back in the Inbox. The bridge still dedupes by title|artist, so an exact
// catalogue duplicate resolves to the existing song (added: 0) instead of a second copy; a false-positive
// prefix match ("Free" vs "Freedom") becomes a genuinely new song.
async function acceptSubmission(db, id) {
  const claim = await db.query(
    `WITH old AS (
       SELECT id, existing_song_id FROM song_submissions WHERE id=$1 AND status='pending' FOR UPDATE)
     UPDATE song_submissions ss
     SET status='approved', resolved_at=CURRENT_TIMESTAMP, resolved_by='admin', existing_song_id=NULL
     FROM old WHERE ss.id = old.id
     RETURNING old.existing_song_id AS prior_match`, [id]);
  if (!claim.rowCount) { await assertPending(db, id); throw coded('NOT_PENDING', 'submission was already resolved'); }
  const priorMatch = claim.rows[0].prior_match;
  const revert = () => db.query(
    `UPDATE song_submissions SET status='pending', resolved_at=NULL, resolved_by=NULL, existing_song_id=$2 WHERE id=$1`,
    [id, priorMatch]);
  let bridged;
  try {
    bridged = await staging.addSubmissionAsPending(db, id);
  } catch (e) { await revert(); throw e; }
  if (!bridged.song_id) {
    await revert();
    throw coded('NO_SONG', 'could not add or find a song for this submission');
  }
  return { song_id: bridged.song_id, added: bridged.added };
}

async function dismissSubmission(db, id, note) {
  const text = typeof note === 'string' && note.trim() ? note.trim() : null;
  const u = await db.query(
    `UPDATE song_submissions SET status='rejected', admin_notes=$2, resolved_at=CURRENT_TIMESTAMP, resolved_by='admin'
     WHERE id=$1 AND status='pending'`, [id, text]);
  if (!u.rowCount) await assertPending(db, id); // distinguishes NOT_FOUND / NOT_PENDING
}

module.exports = { listInbox, acceptSubmission, dismissSubmission };
