// YouTube video panel service — owns the "exactly one primary per song" invariant.
const VIDEO_TYPES = ['official', 'live', 'lyric', 'fan-made', 'other'];
const YT_ID = /^[a-zA-Z0-9_-]{11}$/;

async function addVideo(db, songId, { youtube_id, video_title = null, video_type = 'official', is_primary = false } = {}) {
  if ((await db.query('SELECT 1 FROM songs WHERE id=$1', [songId])).rows.length === 0) {
    const e = new Error('song not found'); e.code = 'NOT_FOUND'; throw e;
  }
  if (!YT_ID.test(String(youtube_id || ''))) { const e = new Error('invalid youtube_id (need 11 chars)'); e.code = 'BAD_INPUT'; throw e; }
  if (!VIDEO_TYPES.includes(video_type)) { const e = new Error('invalid video_type'); e.code = 'BAD_INPUT'; throw e; }

  const count = (await db.query('SELECT COUNT(*)::int AS n FROM youtube_videos WHERE song_id=$1', [songId])).rows[0].n;
  const makePrimary = is_primary || count === 0; // first video is always primary
  if (makePrimary) await db.query('UPDATE youtube_videos SET is_primary=false WHERE song_id=$1', [songId]);
  const r = await db.query(`
    INSERT INTO youtube_videos (song_id, youtube_id, video_title, thumbnail_url, video_type, is_primary, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
    RETURNING id, song_id, youtube_id, video_title, video_type, is_primary`,
    [songId, youtube_id, video_title, `https://img.youtube.com/vi/${youtube_id}/mqdefault.jpg`, video_type, makePrimary]);
  return r.rows[0];
}

async function updateVideo(db, videoId, { video_title, video_type } = {}) {
  if (video_type != null && !VIDEO_TYPES.includes(video_type)) { const e = new Error('invalid video_type'); e.code = 'BAD_INPUT'; throw e; }
  const sets = [], params = [videoId];
  const add = (col, val) => { if (val !== undefined) { params.push(val === '' ? null : val); sets.push(`${col}=$${params.length}`); } };
  add('video_title', video_title); add('video_type', video_type);
  if (!sets.length) { const e = new Error('no fields to update'); e.code = 'BAD_INPUT'; throw e; }
  const r = await db.query(`UPDATE youtube_videos SET ${sets.join(', ')} WHERE id=$1
    RETURNING id, song_id, youtube_id, video_title, video_type, is_primary`, params);
  if (!r.rows.length) { const e = new Error('video not found'); e.code = 'NOT_FOUND'; throw e; }
  return r.rows[0];
}

async function setPrimaryVideo(db, videoId) {
  const v = (await db.query('SELECT song_id FROM youtube_videos WHERE id=$1', [videoId])).rows[0];
  if (!v) { const e = new Error('video not found'); e.code = 'NOT_FOUND'; throw e; }
  await db.query('UPDATE youtube_videos SET is_primary=false WHERE song_id=$1', [v.song_id]);
  const r = await db.query(`UPDATE youtube_videos SET is_primary=true WHERE id=$1
    RETURNING id, song_id, youtube_id, video_title, video_type, is_primary`, [videoId]);
  return r.rows[0];
}

async function deleteVideo(db, videoId) {
  const v = (await db.query('SELECT song_id, is_primary FROM youtube_videos WHERE id=$1', [videoId])).rows[0];
  if (!v) { const e = new Error('video not found'); e.code = 'NOT_FOUND'; throw e; }
  await db.query('DELETE FROM youtube_videos WHERE id=$1', [videoId]);
  if (v.is_primary) {
    const next = (await db.query('SELECT id FROM youtube_videos WHERE song_id=$1 ORDER BY id LIMIT 1', [v.song_id])).rows[0];
    if (next) await db.query('UPDATE youtube_videos SET is_primary=true WHERE id=$1', [next.id]);
  }
  return { deleted: true, song_id: v.song_id };
}

module.exports = { VIDEO_TYPES, addVideo, updateVideo, setPrimaryVideo, deleteVideo };
