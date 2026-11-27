# Reply to the Artist Enrichment V2 plan (`vegan-playlist` to `vegan-playlist-analysis`)

**Date:** 2026-11-27
**In response to:** `docs/ARTIST_ENRICHMENT_DATA_REVIEW_RESPONSE.md`
**Status:** technical sign-off from the main project's side, plus a compatibility contract. Where an answer depends on a curator design decision that has not been made yet, it says so ("curator to confirm").

---

## 1. Overall

The plan addresses every P0 and P1 finding, and the root-cause list is convincing. Three points to carry into the build:

1. **Make the validators measurable.** Use the artists named in the review as a golden set: ids 227 Cattle Decapitation, 95 Bikini Kill, 34 Paul McCartney, 68, 286, 1373, 13, 32, 459, 499, 3645, 3682, 3552 must come out `VEGETARIAN_OR_ANIMAL_RIGHTS` (or a vegan-member stance only where a member is separately and explicitly vegan); ids 81 Earth Crisis, 3694 Motionless In White, 3614 Cenizas, 354 Homeboy Sandman, 3691 Megadeth must keep their vegan stance. Run it before and after the re-run and report the result. A second LLM (L4C) reading the same snippets is not an independent check; the deterministic gate (L4B) is the control that matters.
2. **Split two kinds of catalogue conflict.** An external-vs-external disagreement (MusicBrainz vs Wikidata vs Bandcamp) is a true `CONFLICT`. An external value vs our own album dates is a weaker signal, because `albums.release_date` is Spotify's and can be a reissue date (id 163 Icons Of Filth: our 1977 looks wrong, not MusicBrainz's 1983). Please emit these as different statuses (for example `CATALOGUE_DISAGREES`) so the curator sees which side is likely wrong.
3. **No lyric text in staging, ever.** The `catalogue_lyric_signal` idea is fine, but only codes (`advocacy`, `themes`, `topics`) and song titles. Lyric text, transcript text and quotes from them are local-only and must never be copied into any staging column, snippet or note (the main project's copyright rule). Your anti-circularity guardrail (lyrics alone never raise an artist above `THEMATIC_OR_SINGLE_SONG`) is right.

---

## 2. Answers to the four alignment questions

### Q1. Stance and member shape: does it fit the workbench?

**Yes as data; the UI is not designed yet.** The six-value stance enum, per-member `ethical_stance`, per-attribute provenance and `scene_tags` can all be displayed. Constraints to keep in mind:

- `artist_members.vegan` is **curator-only** in the web app. A staged `vegan: true` / `ethical_stance = 'VEGAN'` will only pre-select a suggestion with its evidence next to it; the curator's click writes the value. It will never be imported automatically.
- The web app has no column for stance, aliases, tenure or scene tags yet. Whether and where they are stored on `artists` / `artist_members` is part of the artist-admin redesign (curator to confirm). For now treat them as review-only information.
- Please keep `is_current` (boolean) and `source` on every member (see the contract in section 3); the current reader drops a member without a name, a boolean status and a recognised source.

### Q2. Conflict and evidence shapes

**Yes, with two additions.** `field_conflicts` and the resolved `evidence_sources` objects give the per-artist card what it needs: each candidate's value, source, confidence and detail, plus a clickable final URL, title and domain. Additions:

- Add a **`quote`** (the supporting snippet text) to each evidence entry and tie every entry to the field or member it supports (`supports: "country"` or `supports: "member:chris cerulli:vegan"`). The card shows the value, the source, the final URL and the quote together.
- Keep the staged value usable on its own. If a field has a `CONFLICT`, still stage the **leading candidate** in the usual `proposed_*` column (so the reader never sees a missing value) and set the conflict flag; the card shows both. Do not put the conflicted value only inside the JSON.

### Q3. Who owns `artist_enrichment_review`?

**The main project.** It is a web-owned table from branch `session-enrichment-review` (spec `docs/superpowers/specs/2026-11-23-artist-enrichment-design.md`): `artist_id` (FK to `artists`, cascade), `match_decision` (`approved` / `rejected`), `matched_mbid`, `finished_at`, `updated_at`; 6 rows today. It stores the curator's decisions about a proposed MusicBrainz match, and only the web app writes it. **My review was wrong to call it undocumented (F2.7 is withdrawn).** Do not read, write, archive or reference it. Because it is keyed on `matched_mbid`, a decision only applies while the proposal's id still equals that id; if a re-run changes a proposed MusicBrainz id, the match becomes undecided again, which is the behaviour we want.

### Q4. Catalogue bounds display

**Show them as a separate "from the catalogue" reference, not as a proposal.** The review panel already shows the artist's own albums and years beside the proposed values and warns when a proposed last release is earlier than the catalogue's latest album year. `catalogue_earliest_year` / `catalogue_latest_year` fit that exactly, and they must never be accepted into `first_release_year` / `last_release_year` from the staging table (curator to confirm the layout).

---

## 3. Compatibility contract (the main project already reads this table)

Branch `session-enrichment-review` (not yet merged to `main`; it is awaiting the curator's review) has a live reader, `backend/services/artistEnrichment.js`. It reads the staging table **live** with an explicit column list. To avoid breaking it, and the curator's in-progress review, please keep V2 **additive**:

**Do not rename, retype or drop** these columns, and keep their value vocabularies:

`proposed_musicbrainz_id`, `mbid_match_method` (`EXISTING | WIKIDATA_P1902 | MB_SPOTIFY_URL | MB_TITLE_VERIFIED`), `mbid_confidence`, `artist_type`, `proposed_country` (+ `country_source`, `country_confidence`), `proposed_formed_year`, `proposed_disbanded_year` (+ their source and confidence columns), `proposed_first_release_year` and `proposed_last_release_year` (+ source and confidence), `proposed_bandcamp_url`, `proposed_members`, `proposed_bio`, `proposed_vegan_notes`, `artist_vegan_stance`, `evidence_urls`, `evidence_snippets`, `review_status`.

**Rules the reader depends on:**

- `*_source` values must come from the main project's allow-list: `MusicBrainz`, `Wikidata`, `Bandcamp`, `Catalogue Albums`, `Gemini Web Search`, `Added by curator`. A fact whose source is not on the list is silently ignored by the reader. If V2 needs a new label (for example for a corroborated or verified value), tell us first and we will add it to `artistFacts.SOURCES`; do not invent labels in staging. Ungrounded model-memory answers should simply **not be staged as a proposal** (leave the column null, or put them in a separate review-only column). Please do not label them `Gemini Web Search`.
- `*_confidence`: keep `EXACT_ID | HIGH | MEDIUM | LOW`. Adding `CONFLICT` is fine as a new value; the main project will make sure a `CONFLICT` row is never treated as pre-trusted (the current reader only pre-trusts `EXACT_ID` matches, but the V2-aware reader will be checked against your new values). Your `CATALOGUE` confidence value belongs only in the separate catalogue columns.
- `proposed_members[]`: each element keeps `name` (string), `is_current` (boolean), `source` (one of the allow-list) and `vegan` (boolean, if present). New keys (`canonical_key`, `aliases`, `ethical_stance`, `start_year`, `name_source`, ...) are welcome and additive. If you rename `source` to `name_source`, keep both.
- `proposed_formed_year` / `proposed_disbanded_year`: still read for warnings. If you stop producing them, leave them null (do not drop the columns).
- `Person`-type artists: the reader warns when a `Person` carries a member list. Your solo-artist rule (empty `proposed_members`) removes the warning.
- `proposed_website_url` is not read today, but the main project now stores a band's website separately from Bandcamp (`artists.website_url`). Only non-social, non-Bandcamp, non-streaming-platform URLs are useful. `proposed_bandcamp_url` must be a `*.bandcamp.com` origin.

**How to migrate and re-run safely:**

- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` only. No `DROP`, no `TRUNCATE`, no table re-create, no mass `DELETE` of proposal rows. The web app's review table depends only on `artists`, but the reader assumes one proposal row per staged artist.
- Write a new row's values in one `UPDATE`/upsert per artist, so the reader never sees a half-written row. Tell us the date of the re-run; the curator may be mid-review.
- Add `last_run_id` and `pipeline_version` to the proposal row so the card can show which run a value came from. Add `source_artist_updated_at` as planned; the web app will use it to flag a proposal as stale after a curator edit.
- Keep the existing `evidence_urls` array, but write **resolved** URLs into it going forward, and keep `evidence_snippets[].url` equal to a member of `evidence_urls`.

**What the main project will do on its side** (not part of your work): merge `main` into the enrichment branch, add `first_release_year` to the review reader, and then build the V2-aware artist review once the curator has reviewed the branch.

---

## 4. Smaller points on the V2 plan

- **Cap at the current year, not `[1900, CURRENT_YEAR]` only.** Also drop MusicBrainz release groups with a future or `NULL` date, and say in the row when a release was dropped for that reason (ids 1596 Fear Factory, 39364 Julien Baker).
- **Country semantics are accepted** (country of origin or formation, present-day name, `secondary_countries` for binational). id 4011 The Rebel Riot as Myanmar is withdrawn as suspect. The main project's stored `USA` will be normalised on our side.
- **`SEARCHED_UNVERIFIED` vs `NOT_SEARCHED`** is exactly the distinction wanted. Please keep `UNVERIFIED` rows out of any "no vegan connection" reading; absence of evidence is not evidence of absence.
- **Straight edge:** `scene_tags` is welcome and should never imply a vegan stance.
- **Re-run order:** run the golden set (section 1) and the F3 catalogue comparison first on the existing 803 rows with the new validators as a dry run, and send us the before/after counts. We will confirm before you overwrite the live rows.
