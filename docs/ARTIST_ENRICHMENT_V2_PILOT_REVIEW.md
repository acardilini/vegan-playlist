# Artist Enrichment V2: main-project review of the pilot report and the drain in progress

**Date:** 2026-11-27 · **Reviewer:** main project · **Read:** `ARTIST_ENRICHMENT_V2_PILOT_REPORT.md`, then the live staging tables (read-only SQL, plus the web app's own review reader run over every row).
**Written for:** the analysis project (relay by the curator).

## Verdict

The pilot's claims check out and the two findings it names are fixed. **The drain is signed off by the curator, but the results are not accepted yet**, because the live data has moved well past the pilot (see the run table in 1) and four things need fixing or answering first (3 to 6).

## 1. Process: the drain and the cost (curator decisions, 2026-11-27)

The curator has signed off the drain and says the spend over the earlier cap is fine, so neither is a finding. For the record, the run table:

| Run | Stage | Rows | Cost | State |
|---|---|---|---|---|
| `4a7234c5` | BACKFILL_4B | 794 | $0 | done 06:55 to 07:02 |
| `696cf973` | PILOT | 24 + 6 | $0.304 | done 07:17 |
| `4309c688` | conflict | 2 | $0.036 | done 08:29 |
| `5f7fe18b` | DRAIN L4C-1 | 334 | $2.243 | done 09:02 |
| `ca9fdc11` | DRAIN L4C-2 | 235 | running (22 done by 09:13) | open |

One request stands: **there is no way back from the database.** No backup table exists, and `artist_enrichment_snapshots` holds model *responses* (`raw_response_json`), not the row as it was. Please confirm a pre-backfill export exists, and from now on write a pre-image row into the snapshot before any live update.

## 3. BLOCKER: a corrected-identity row still looks exactly like a trusted match (artist 3625, Culture Shock)

L4C-2 resolved this row as `WRONG_MBID_IDENTITY_CORRECTED`. Its rationale says MusicBrainz is linked to a *different* act (a UK drum and bass solo artist). The row was not changed to match:

- `proposed_musicbrainz_id` is still `0068b96e-...`, `mbid_match_method = MB_SPOTIFY_URL`, `mbid_confidence = EXACT_ID`;
- `proposed_country` is still `United Kingdom`, source `MusicBrainz`, `EXACT_ID` (taken from the wrong entity);
- only the years were replaced (1986 to 2026, source `Gemini Web Search`).

The review reader therefore shows the match as **`pretrusted`**, so "Accept all shown" would write the wrong MusicBrainz id to `artists.musicbrainz_id`. **Ask:** when L4C-2 resolves `WRONG_MBID_IDENTITY_CORRECTED`, set `mbid_confidence = 'CONFLICT'` (or null the id and the method), clear every MusicBrainz-sourced field and say so in `validation_notes`. Only this one row is affected today, but 235 more are being processed. **The main project has now added a reader-side guard** (`debdf30`: a `WRONG_MBID_IDENTITY_CORRECTED` verdict can never be `pretrusted`, so the row opens as 'Match needs your approval' with its MusicBrainz facts locked); that is defence in depth, not a substitute for fixing the row.

## 4. L4C-1 false demotions: the Earth Crisis class is not fixed

Finding #1's fix (escalate a demotion to L4C-2) worked for Earth Crisis (81: L4C-1 demoted it, L4C-2 restored `EXPLICIT_VEGAN_BAND`, first release 1992, last 2025). But it is applied only to rows carrying `escalate_to_l4c2`:

- **61 rows** carry `note_claims_vegan_without_snippet`; **only 2 have been restored**. 41 sit at `VEGETARIAN_OR_ANIMAL_RIGHTS`, 14 at `THEMATIC_OR_SINGLE_SONG`, 4 at `SEARCHED_UNVERIFIED`.
- About two dozen of these have `escalate_to_l4c2 = false`, so the L4C-2 drain will never see them.
- The stored notes describe several as **personally vegan in the artist's own right**: Jerry Heil (#3562), Disl Automatic (#259), Max Rage (#3690), Vermintide (#3566, "confirmed vegan"), First Blood (#3668, "staunch vegan"), Gary Yourofsky (#3641), Sole (#77). Their demotion comes from the stored *snippets* not quoting them, not from evidence against them.

**Ask:** route every row carrying `note_claims_vegan_without_snippet` to L4C-2, whether or not it is flagged `escalate_to_l4c2`. This probably costs less than it sounds, because many of those rows are already in the 235. If cost forces a cut, cut elsewhere: do not drop these.

**Also show the evidence for the overrides.** The Earth Crisis override rationale rests on reputation ("universally recognized as the definitive band..."), the same kind of unsourced claim L4C-1 exists to remove. For the 2 `l4c2_stance_override` rows (#81, #10) please show the new URL and quote that supports personal or band-wide veganism; if there is none, the override should not stand.

## 5. Consistency problems in the staged data

- **#77 Sole:** stance `VEGAN_MEMBERS` (set by L4C-2 `GAP_FILLED`) with **zero** members listed. A solo artist has no members; this should be a different stance or have the artist as the vegan member.
- One `VEGETARIAN_OR_ANIMAL_RIGHTS` row has 2 members marked `vegan: true`.
- **3 V2 rows** have a member with `vegan: true` and no `vegan_evidence_url` (2 HIGH, 1 MEDIUM), against your own rule.
- **8 rows are not V2** (`pipeline_version` null): #266 and #3805 (`EXPLICIT_VEGAN_BAND`), #28106 (`VEGAN_MEMBERS`), and five with the stance `UNVERIFIED`, which is **not in the agreed enum**. They still carry V1 content (and 3 unresolved redirect URLs), so the "1311/1311 resolved" claim is true only of the 794 eligible rows. Process them or mark them clearly as excluded.
- Note: the staging table now has 801 rows, not 803. That is consistent with the curator's artist merges in the web app (a merge deletes the loser and cascades its proposal row); I have not matched each missing row to a merge.

## 6. What the main project verified as sound

- All **801** rows read through the web app's review reader with **zero errors**; every `*_source` value is in the allow-list; member records keep `name`, `is_current`, `source`, `vegan`. `artists.bio` is still empty. (`artist_members` and `artist_enrichment_review` now hold curator-made rows, so the report's "untouched" counts can no longer be compared; no bio or stance column has been written.)
- Finding #2's fix works: #1664 now has first release 1991 (`EXTERNAL_INCOMPLETE_CORRECTED`, `Gemini Web Search`, MEDIUM).
- The new `first_release_year` proposal is already surfaced in the review (609 artists); **#163 now carries the evidence the curator needs**: L4C-2 says the catalogue's 1977 date is a distribution metadata error and the MusicBrainz 1983 stands.
- Member flags: 175 `vegan: true / ethical_stance VEGAN`, all but 3 with an evidence URL; `EXPLICITLY_NOT_VEGAN` is used (2 rows) and kept out of vegan flags.

## 7. What the main project will do next (not blocking you)

1. Reader guard for `WRONG_MBID_IDENTITY_CORRECTED` (above).
2. A V2-aware review: show `field_conflicts`, confidence for MEDIUM and LOW, the evidence URL and quote behind each Gemini-sourced fact (today a `Gemini Web Search` fact at MEDIUM can be filled by "Accept all shown" without the curator seeing its evidence), stance and member evidence. This feeds the artist-admin redesign.
3. Possible duplicate the shared-id check cannot see: **Disl Auto (#272) and Disl Automatic (#259)** have different Spotify ids and no MusicBrainz id on the first; a curator merge, not an analysis problem.

## 8. Before the drain's output is accepted

1. Confirm a pre-backfill export of `artist_enrichment_proposals` exists (or take one now).
2. Fix the `WRONG_MBID_IDENTITY_CORRECTED` row handling (3).
3. Route all `note_claims_vegan_without_snippet` rows to L4C-2 and show evidence for the overrides (4).
4. Answer or fix section 5.
5. Report final spend, and tell us when the run `ca9fdc11` has finished. The main project will re-run this review on the finished data.
