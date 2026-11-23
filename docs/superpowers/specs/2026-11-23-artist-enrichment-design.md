# Artist enrichment review (design)

Date: 2026-11-23. Status: DRAFT for curator approval. Size: a project, built as three pieces (each its own branch, plan,
smoke and "Merge"). Input: `docs/MAIN_PROJECT_ARTIST_ENRICHMENT_HANDOFF.md` (analysis project), curator decisions below.

## Intent and why
The analysis project has staged free proposals for 803 artists in `artist_enrichment_proposals` (all `PENDING`, 642
published): MusicBrainz ids, countries, formed / disbanded / last-release years, member lists, Bandcamp urls. Today
`artists` holds almost none of this (1 country, 3 MusicBrainz ids), so the public artist pages are thin and the planned
Data world map has nothing to draw. The curator wants this information on the artists, with **where each value came
from always visible**, and without a wrong band's facts ever reaching the public site. Success: every published artist has
been reviewed; accepted facts show on the artist page and workbench with a source; no fact is applied without a click.

## Goals
- A per-artist review flow where the curator first approves the **artist match**, then accepts or skips each proposed fact.
- Provenance on every stored fact, expanded beyond MusicBrainz, with a link to check it.
- No Active/Inactive indicator (a band can reform); instead the public page shows the range of their published work
  (first to last release).
- A safe **artist merge** for duplicate artist rows (curator: "merge into one is correct").

## Non-goals / anti-goals
- No bulk approve in the first build (the curator reviews every band; a quick "accept all shown, next artist" per artist
  is the fast path). No Layer 4 (bio, vegan stance, evidence): parked, curator will revisit where it best fits.
- Not stored: Wikidata id, website url proposals, Wikipedia extracts, raw Bandcamp text.
- The web app **never writes** `artist_enrichment_proposals`; the analysis project never writes `artists` /
  `artist_members` (existing Option A invariant). No public route may read the staging or review tables (test-enforced,
  like `leads`).
- Anti-goal: a title-matched wrong band's country / years / members becoming public.

## Constraints
- `bandCheck.saveIdentity` stays the single writer of `artists.musicbrainz_id` / `bandcamp_url`; approving a match or a
  Bandcamp proposal goes through it. Merge must not become a second identity writer (see Piece 3).
- Every change is weighed against the 650-song dataset: merge is the only piece that moves `song_artists`.
- `artistFacts.saveFacts` / `addMember` remain the only fact writers (`vegan` stays curator-only, default false).
- Test sentinel unique per file (e.g. `ZZZENR`, `ZZZAMG`); tests never touch real artists.

## Approaches considered (curator chose A for the review, order 1 -> 2 -> 3)
- **A. Review inside the artist workbench (chosen).** An "Enrichment" rail in the Artists area lists artists to review;
  the workbench gets a "Proposed enrichment" panel. Reuses `QueueRail`, `saveIdentity`, `ArtistFactsPanel`; the later
  artist-admin work grows from it.
- B. A separate full-screen review flow. Focused, but a second place to maintain and it duplicates the facts UI.
- C. Bulk approve first, exceptions per artist. Rejected: the curator reviews every band.
- Staging read: proposals are read **live** from the table (read-only), not copied. Review state lives in a web-owned
  table (below). Copying would duplicate data the analysis project can refresh.

## Piece 1 - Provenance and published-work range (small)
**Amended 2026-11-23 (curator): no Active/Inactive indicator. Show the range of published work instead.** Plan:
`docs/superpowers/plans/2026-11-23-artist-enrichment-1-provenance.md`.
- `artistFacts.SOURCES` becomes: `MusicBrainz`, `Wikidata`, `Bandcamp`, `Catalogue Albums`, `Gemini Web Search`,
  `Added by curator`. Members' `source` uses the same set. No migration for this (columns are free text).
- `activeStatus`, `facts.active`, the public `active_label` and the Active override UI are **removed**; the
  `artists.active_override` column stays, dormant. The disbanded year stays stored and admin-only.
- New fact `artists.first_release_year` (+ `first_release_source`, migration 024): editable in the Facts panel, proposed
  by "Fill from MusicBrainz" (earliest Album/EP/Single release group, same exclusions as last release), and to be staged
  by the analysis project. The public summary line becomes e.g. `Germany · Formed 2009 · Released 1996–2024`
  (`Released 1999` when equal; `Last release 2024` or `First release 1996` when only one is known).
- Admin: each stored fact shows its source name, and where a check-link can be built it shows one (MusicBrainz ->
  `musicbrainz.org/artist/<id>` from the artist's stored id; Bandcamp -> the stored url; Wikidata -> the proposal's QID
  when reviewing; Catalogue Albums -> none; Gemini -> the proposal's evidence urls). Public pages show no sources (as now).

## Piece 2 - Match and facts review
**Data.** New web-owned table `artist_enrichment_review` (next free migration number): `artist_id` PK (FK artists,
ON DELETE CASCADE), `match_decision` (`approved` | `rejected` | NULL), `matched_mbid` UUID (the proposed id the decision
applies to), `finished_at`, `updated_at`. A decision applies only while the proposal's id still equals `matched_mbid`
(if the analysis project changes the proposed id, the match is undecided again). Also add a partial unique index on
`artists.musicbrainz_id` (lower-cased, where not null) so the DB catches a wrong or duplicate match; migration checks it
can be created (3 ids stored today).

**Queue.** `services/artistEnrichment.js` reads proposals LEFT JOIN review; an artist is in the queue while
`finished_at IS NULL` and the proposal has something to review (anything proposed that differs from what is stored).
Order: title-verified (`HIGH`) matches first, then artists whose proposed id is shared with another artist or already
stored on another artist (duplicates), then the rest by total song count descending. New rail group "Enrichment" with
counts (To review, Match to approve, Possible duplicates, Done). Count and list share one predicate table, like `artists.js`.

**Match step.** Shows the proposed MusicBrainz page link, method (`MB_SPOTIFY_URL`, `WIKIDATA_P1902`, `MB_TITLE_VERIFIED`,
`EXISTING`), confidence and the artist's own catalogue (songs, albums, years, our Spotify/Bandcamp links) side by side.
Actions: **Approve match** (writes `musicbrainz_id` via `saveIdentity`; also records the decision), **Reject match**
(records it; facts that came from that id are hidden for this artist and it stays in Needs identity), **Not sure**
(leave). `EXACT_ID` matches (272) are shown as pre-trusted: approved by the artist's single "Accept all shown" click, so
only the 150 `HIGH` ones need an explicit match approval first (my call; the curator may require it for all). If the id is
already stored on, or proposed for, another artist the panel says so and offers **Merge** (Piece 3) instead of Approve.
Facts sourced from MusicBrainz or Wikidata are locked until the match is approved (or `EXACT_ID`/`EXISTING`); facts
from Bandcamp or Catalogue Albums do not depend on the match.

**Facts step.** One row per proposed field: country, formed year, disbanded year, last-release year, Bandcamp url,
members. Each shows stored vs proposed, source, confidence and the check-link; equal values are omitted; Accept / Skip per
row, plus "Accept all shown, next artist". Accept goes through `saveFacts` / `addMember` (members: `vegan = false`,
matched by `nameKey`, never deleting or changing an existing member) and Bandcamp url through `saveIdentity`. Country
text is stored exactly as proposed (matches `Intl.DisplayNames`); the one stored `USA` is normalised when the curator
accepts `United States` over it. **Skip stores nothing**; "Done with this artist" sets `finished_at`.
**Warnings** shown inline: proposed last release earlier than the catalogue's own latest album year (show that year
beside it); disbanded before last release; formed after the first catalogue release; a `Person` artist with a member list;
an id shared with another artist.

**Frontend.** `EnrichmentPanel` in `ArtistWorkbench` (above `ArtistFactsPanel`), a rail group in `ArtistsArea`, Next
artist moves through the queue. Admin routes under `/api/admin/artists/:id/enrichment*` and `/api/admin/enrichment/queue`.

## Piece 3 - Artist merge
- `services/artistMerge.js`: `preview(keeperId, loserId)` (read-only) and `merge(keeperId, loserId)` (one transaction,
  needs the preview's loser snapshot hash so a changed row aborts, `CONFLICT`).
- Moves: `song_artists` (links the keeper already has are dropped; **song order per song is preserved**), `artist_members`
  (name-key duplicates skipped), `leads.artist_id` repointed, `artist_enrichment_review` / proposals follow the loser's
  cascade delete. Keeper's blank fields are filled from the loser (bio, notes, links, facts with their sources, website);
  where both have a different value **the keeper wins** and the differing loser values are listed in the preview so the
  curator can copy them first. Review notes are concatenated, never overwritten.
- Identity: a loser's `spotify_id` / `bandcamp_url` / `musicbrainz_id` is carried to a blank keeper field by calling the
  same validation as `saveIdentity` (clear the loser's value first inside the transaction); if both differ, keeper wins.
- Safety: a row in a new `artist_merges` table (`loser_id`, `keeper_id`, `loser_snapshot` JSONB, `merged_at`) is written
  before the loser is deleted, so a merge can be reconstructed by hand. After a merge the loser's `/artist/:id` 404s.
- Entry points: the "same id as another artist" flag in Piece 2, and a "Merge into another artist" action on the workbench
  (pick the keeper by search; default keeper is the row with more songs). Never automatic, never bulk.
- Known first cases: Tenastelin / Tena Stelin (208/129), two `xapothecaryx` (324/339), The Instigators / Instigators
  (3777/3878), Melanie Safka / Melanie (32/3896, the second has 0 songs). Live-song counts for each are shown in the preview.

## Testing and verification
Backend `node:test` per piece (sentinels unique per file): provenance set, first-release fact and public range payload; queue predicate vs
counts; match decision applies only while the id matches; accept paths write through the single writers and never delete
members or touch `vegan`; skip stores nothing; a privacy test that no public route/service references the staging or review
tables; merge preview equals what merge does, song_artists conflicts, rollback on a failing step, snapshot written.
Smoke per piece in the chat (full steps), including the first duplicate pairs for Piece 3.

## Left to the builder
Exact queue SQL, rail labels and layout of the match panel, migration numbers, the `summaryLine` wording, how the
catalogue years are read, and the loser snapshot hash. Real data: re-run the recon counts (803 proposals, 4 shared-id pairs,
150 title-verified) before building; the table may have been refreshed.

## Calls I made (flagged for the curator)
1. `EXACT_ID` matches need no separate approval click; only title-verified ones do.
2. A rejected match hides that artist's MusicBrainz/Wikidata facts but keeps the artist in Needs identity.
3. Web app never writes the staging table; review state is its own table.
4. Merge: keeper wins on conflicts; loser snapshot kept; merge is never bulk or automatic.
5. Website urls, Wikidata ids and Wikipedia extracts are not stored in this build.
6. Partial unique index on `musicbrainz_id`.
