# backend/scripts

Maintenance scripts that are still part of the project's workflow. Run from the
`backend/` directory: `node scripts/<name>.js`. Everything else that used to live here
(37 one-off setup/debug/test scripts) was deleted in Session 2.3 — git history preserves
them (`git log --diff-filter=D -- backend/scripts` to find them).

Schema changes do **not** happen through scripts: they live as SQL files in
`database/migrations/`, applied with psql.

## The scripts

### `consolidateSpreadsheets.js` — truth-source import
Imports the curator's two source spreadsheets (`docs/playlist/`, gitignored) into the
DB: statuses, lyrics (local-only `song_lyrics`), links, new songs. Idempotent;
**dry-run by default**, pass `--apply` to write (take a DB backup first). Import never
overrides curator state — conflicts go to a review report in `logs/`.
Spec: `docs/TRUTH_SOURCE_DESIGN.md`.

### `enrichFromSpotify.js` — Spotify enrichment pipeline
The single replacement for the legacy import/sync scripts. Writes **only**
enrichment-class fields, never curatorial ones. **Dry-run by default**, `--apply` to
write; stages `--albums` / `--artists` / `--attach` / `--diff` (playlist diff is
import-only: missing tracks become `pending`). The admin Staging tab's Sync button calls
the same logic via `utils/playlistSync.js`.

### `auditDatabase.js` — read-only completion audit
Prints field-completion rates (metadata, categorisation, audio features, YouTube, moods)
across the catalogue. No writes.

### `exportAllSongsData.js` — read-only data export
Dumps all songs with category data to `vegan_playlist_complete_data.csv` at the repo
root, for external analysis or backup. No writes to the DB. Note: full lyrics are
**never** part of exports that leave this machine (`song_lyrics` is local-only,
copyright).

> Migration 006 (Sub-project A1) added `song_lyrics.translation` — also local-only
> (copyright). The same rule applies: no public route may SELECT it, and it is covered by
> the `pg_dump --exclude-table-data=song_lyrics` production-dump exclusion.
