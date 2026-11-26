# Handoff to the analysis project: the audio analysis video

**What changed in the web app (migration 029, 2026-11-27).** The curator can now choose which YouTube video the audio analysis should hear for a song, independent of the primary video (e.g. primary = a live video shown on the site, analysis = the album recording).

**What to read.** Two new columns on `songs`:

- `audio_video_id INTEGER` -> `youtube_videos(id)`, `ON DELETE SET NULL`. NULL means "use the primary video" (the default for every existing song, so nothing changes until the curator picks one).
- `audio_video_set_at TIMESTAMPTZ`: stamped by the web app on every change, including going back to the default.

**The rule.** The video to download for a song is:

```sql
SELECT yv.youtube_id
FROM songs s
JOIN youtube_videos yv ON yv.id = COALESCE(s.audio_video_id,
       (SELECT id FROM youtube_videos WHERE song_id = s.id AND is_primary = true))
WHERE s.id = :song_id;
```

The web app keeps `audio_video_id` only for a deliberate override: choosing the primary video clears it to NULL, and deleting the chosen video clears it (FK), so a non-NULL value always points at a non-primary video of the same song.

**Cache invalidation.** `src/core/cache_audio.py` already drops stale timelines when the primary link changes. It should now key on the *resolved* video id above (a change of `audio_video_id`, of the primary when there is no override, or of `audio_video_set_at` newer than the stored analysis should re-run that song).

**Broken video rail.** The web app's Broken video queue treats a song as fixed when `audio_video_set_at` is later than its latest `UNAVAILABLE` row, so re-running after the curator picks a different video will either write an `OK` row or a newer `UNAVAILABLE` one; both behave correctly. The web app never writes `song_audio_analysis`.
