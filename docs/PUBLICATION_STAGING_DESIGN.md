# Publication Staging Design — Session 1.2b (Phase 1)

_Designed with the curator 2026-07-07 and approved. Extends
[`TRUTH_SOURCE_DESIGN.md`](./TRUTH_SOURCE_DESIGN.md): `status` remains the curator's
inclusion decision; this adds an orthogonal publication dimension._

## The model in one paragraph

**Being in the catalogue and being presentable are different facts.** `songs.status`
(`pending`/`included`/`rejected`) stays exactly as designed in Session 0.4 — the curator's
decision that a song belongs. A new `published` boolean says an included song is also
*ready to show*: it has a way to play it, artwork, and the curator has eyeballed the row.
The public site shows only `status='included' AND published=true`. Publishing is always a
curator click — data completeness is surfaced as guidance, never as an automatic trigger.

## Curator decisions (2026-07-07)

1. **Essentials for going live:** a playable link (Spotify/Bandcamp/SoundCloud URL or a
   YouTube video) + album artwork + curator verification of artist/title.
2. **Verification = the Publish click.** The admin UI shows what's missing; nothing goes
   live without a human look. Unpublish reverses it.
3. **Migration grandfathering:** included songs that already have a play link + artwork
   (1,359) are backfilled as published — they have been live all along and came from vetted
   batches. The 39 incomplete ones start in To-finalise and drop off the public site.
4. Categorisation is **not** an essential (requiring it would empty the site; the
   vegan-themes coding is its own future workstream).

## Workflow queues (admin UI labels; screen ships with Session 1.4)

| Queue | Definition | Today |
|---|---|---|
| **To process** | `status='pending'` (relabel of the existing pending queue) | 178 |
| **To finalise** | `status='included' AND NOT published` — annotated at query time with what's missing (no play link / no artwork); never stored | 39 |
| **Live** | `status='included' AND published` | 1,359 |
| Rejected | `status='rejected'` (unchanged) | 243 |

## Data model (migration `002_published_flag.sql`, additive)

```sql
ALTER TABLE songs ADD COLUMN published BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE songs ADD COLUMN published_at TIMESTAMP;
ALTER TABLE songs ADD CONSTRAINT songs_published_check
  CHECK (NOT published OR status = 'included');  -- only included songs can be live

-- Grandfather complete included songs (play link OR YouTube video, AND artwork)
UPDATE songs s SET published = true, published_at = CURRENT_TIMESTAMP
WHERE s.status = 'included'
  AND (s.spotify_url IS NOT NULL OR s.bandcamp_url IS NOT NULL OR s.soundcloud_url IS NOT NULL
       OR EXISTS (SELECT 1 FROM youtube_videos yv WHERE yv.song_id = s.id))
  AND EXISTS (SELECT 1 FROM albums al WHERE al.id = s.album_id
              AND al.images IS NOT NULL AND al.images::text NOT IN ('null','[]'));
```

The CHECK constraint means any future status change away from `included` on a published
row fails loudly unless it also unpublishes — consistency can't silently drift.

## Behaviour changes

- **Public routes** (same five files as Session 1.1: spotify, analytics, playlists,
  youtube, lyrics): filter becomes `status = 'included' AND published = true`. Public
  totals drop 1,398 → 1,359; unpublished songs 404 publicly.
- **Admin endpoints (this session):** `POST /api/admin/songs/:id/publish` (refuses unless
  `status='included'`; sets `published`, `published_at`) and
  `POST /api/admin/songs/:id/unpublish`. Queue-listing endpoints wait for Session 1.4
  (nothing would call them yet).
- **Unchanged:** `status` semantics and every existing script.
  `consolidateSpreadsheets.js` and `enrichFromSpotify.js` never touch `published`, so newly
  imported includes and diff-added pendings arrive unpublished — which is the staged
  workflow working as intended. Lyrics guardrails unaffected.

## Smoke test (Session 1.2b exit)

Public totals read 1,359 everywhere; one of the 39 To-finalise songs 404s publicly;
publish it via the endpoint → appears on the site; unpublish → 404 again; state restored.
