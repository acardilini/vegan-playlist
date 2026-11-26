# Audio analysis video - design (small change)

**Why.** The analysis pipeline downloads the song's primary YouTube video. Sometimes the primary is a live video (best to show on the site) while another link is the album recording, which is the one the audio analysis should hear. The curator wants to pick that video, defaulting to the primary.

**Goals.** A per-song "audio analysis video" the curator can set from the admin Video panel; unset means "use the primary"; stored in the DB so the analysis project can read it. **Non-goals.** No change to the public site; no changes to the analysis project's code (it gets a handoff note); no per-video type rules.

**Approaches.** (A) a nullable pointer on the song, `songs.audio_video_id` -> `youtube_videos(id) ON DELETE SET NULL` (chosen by the curator): NULL = primary, no backfill, deleting the video falls back to the primary by itself. (B) a second boolean on each video with its own one-per-song index: symmetric but "none flagged" still needs a fallback and more states to keep consistent.

**Design.**
- Migration 029: `songs.audio_video_id INTEGER REFERENCES youtube_videos(id) ON DELETE SET NULL` and `songs.audio_video_set_at TIMESTAMPTZ` (stamped on every change, including clearing, so the Broken video rail and the analysis project can tell the source changed).
- `videos.setAudioVideo(db, songId, videoId | null)`: the video must belong to the song (`NOT_FOUND` / `BAD_INPUT`); choosing the song's **primary** video clears the pointer (the pointer only ever holds a deliberate override); stamps `audio_video_set_at`. Route `PUT /api/admin/workbench/:id/audio-video` body `{ video_id: <id> | null }`.
- The workbench read adds `is_audio_source` to each video (the pointer, else the primary) so the page shows which one is analysed.
- **Broken video rail:** a song also leaves it when `audio_video_set_at` is later than its failed analysis (like adding a replacement link today).
- UI (`VideoPanel`): each video row gets a small **Audio analysis** button; the video used for analysis shows an "audio analysis" tag, and the button on an overridden row clears it back to the primary.
- Handoff `docs/MAIN_PROJECT_AUDIO_VIDEO_HANDOFF.md` for the analysis project: the rule is `COALESCE(audio_video_id's youtube_id, primary's youtube_id)`; re-run/invalidate caches when `audio_video_set_at` changes or the resolved video changes.

**Left to the builder.** Button wording and CSS within the existing Video panel style.
