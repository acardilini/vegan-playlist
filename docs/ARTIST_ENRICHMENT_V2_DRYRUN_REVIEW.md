# Review of the V2 Stage 4B dry-run report (`vegan-playlist` to `vegan-playlist-analysis`)

**Date:** 2026-11-27
**Reviewed:** `docs/ARTIST_ENRICHMENT_V2_DRYRUN_REPORT.md`, against the live `artist_enrichment_proposals` table (read-only SQL; I could not run `validate_artist_proposals.py`, which is not on this machine, so rule behaviour below is approximated in SQL).
**Verdict:** **proceed, with the conditions in section 3.** The deterministic gate is doing the right thing and the report is honest about how much the safe counts shrink. The remaining risks are a golden set that cannot show generalisation, a word-presence rule that is too lexical, and a `search_status` field that is still not telemetry.

---

## 1. Independently confirmed

| Report claim | My check |
|---|---|
| 803 rows; 5 `ZZZ` fixtures; 4 orphans | Confirmed. Orphans are ids 3805 Archote, 266 Queen V, 28106 Blink 182, 3896 Melanie. |
| 1,315 of 1,475 snippets are redirects (89.2%) | Exact match. |
| `layer4_search_queries = 0` on 588 grounded rows | Exact match (587 + 1). |
| Ungrounded Gemini: 70 countries, 56 first years, 104 bios | Exact match. |
| 120 vegan flags attributed to MusicBrainz/Wikidata; 3 `vegan: true` with no note; 10 near-duplicate member artists | Exact match. |
| 20 first-year and 37 last-year catalogue disagreements, split by method | Exact match (12/7/1 and 23/9/4/1). |
| 133 / 151 `Catalogue Albums` values equal our own album years | Exact match. |
| 2 duplicate MBIDs (eligible), 7 name duplicates | Consistent with mine (3 MBID pairs; the third includes orphan id 3896). |
| 58 demotions, 37 stripped member flags | Consistent with my approximations (about 51 and 46), not exact (see section 2.1). |
| "Zero database mutations" | Consistent: the staging table has the same 803 rows, 45 columns and latest `updated_at` as in my first audit, and no new tables exist. |

## 2. Concerns

### 2.1 The golden set shows the cases are handled, not that the rule generalises
The 13 negatives are the artists I named in the review, so they were inputs to designing the rule. 18/18 is expected. A hold-out is needed. From reading the data, here is one the analysis agent has not seen:

- **Should be demoted (vegetarian or animal rights only):** 49 Wings, 119 Subhumans, 1402 Western Addiction, 3669 For I Am King, 3817 Bloodguilt.
- **Should keep a vegan stance (explicit "vegan" identity in the evidence):** 62 Jay Brave, 111 Jme, 219 World of Pleasure, 277 Scarlet Rescue, 344 Feldi, 3673 xUnworthy Of Lifex, 3722 Shooting Daggers, 4024 To Kill, 325 Cageless.
- **Unclear; send to L4C-1 or the curator, do not decide silently:** 263 Boogie Down Productions (KRS-One), 431 Ritual Of Decay, 487 Crass, 3560 Oi Polloi, 3698 Nausea, 24367 Braindead. In all six the *note* says "vegan" but no snippet does, so a word-in-snippet rule demotes them. Demotion is the conservative direction and these may well be right, but they are the rows where a lexical rule is most likely to be wrong. The report should list every row demoted whose note contains "vegan" (I count 11 by approximation).

### 2.2 "The word vegan appears in a snippet" is a weak entailment
It stops the Cattle Decapitation error but not these:
- **Promotes versus is.** About 25 `EXPLICIT_VEGAN_BAND` survivors have evidence that the band *promotes or sings about* veganism and never that it *is* vegan. I read 12; about five look like thematic or animal-rights rows, not vegan bands: 163 Icons Of Filth, 192 Abattoirblues, 240 Most Precious Blood, 243 Michael Harren, 316 Tribunal Animal.
- **Member versus band.** 3776 Hour of Reprisal is `EXPLICIT_VEGAN_BAND` while its only claim is "Guitarist Mike is vegan". That is `VEGAN_MEMBERS`.
- **Subject attachment.** 3618 Cho-Beat passes because the claim mentions "a vegan Facebook profile" (the snippet is only a URL containing the handle `Serchovegan`).
- **Time scope.** 211 Arkangel is `EXPLICIT_VEGAN_BAND` on "during their early era".

Ask: make the L4C-1 entailment audit explicitly check four things (promotes vs is, band vs member, subject attachment, time scope) and apply it to all surviving vegan stances, not only rows with "mixed/single-snippet cues".

### 2.3 `search_status` is a proxy, not telemetry
`SEARCHED_WITH_RESULTS: 685` is derived from "has any evidence URL". Only 592 of the 689 rows with URLs have a Google grounding redirect. The other 97 have only URLs from the deterministic layers (Wikipedia 30, Discogs 11, YouTube 11, Apple Music 5, Spotify 3, ...). Those rows are labelled "searched with results" when nothing shows a search ran. This is the original F2.1 problem relabelled. Ask: mark existing rows `UNKNOWN_LEGACY` for `search_status` until the re-run records real grounding metadata, and report the 97.

### 2.4 Zero conflicts is not corroboration
There are only 16 external conflicts because most fields have a single source, and a single source cannot disagree with itself. The confidence rules already require two agreeing sources for HIGH, which is right; the report should say how many fields reach HIGH that way versus `EXACT_ID` from one source. Also, the 12 "bio year vs first release" gaps are classed as external conflicts, but the bio comes from the same model run as the facts. Label them `INTERNAL_INCONSISTENCY`, not external `CONFLICT`.

### 2.5 No row-level output, so nothing can be sampled
The report gives counts. To audit it I need ids. Ask for one file (`dryrun_flags.csv` or a table `artist_id, field, flag, before, after, detail`) containing: all 58 demotions, the 37 stripped member flags, the 16 conflicts, the 57 catalogue disagreements, the 97 non-search rows and the Stage 4C queue with the reason each row is in it.

### 2.6 Stage 4C: sizing, cost and undefined "Path B"
- 607 of 794 artists (76%) go to an LLM stage. 432 of the L4C-2 rows are "ungrounded / null `artist_type` / pilot / lyric-signalled gaps". `artist_type` is null on 390 rows and can largely be set deterministically (MusicBrainz `type`, member lists, Wikidata). Please break down how many rows need L4C-2 for `artist_type` alone and resolve those without an LLM.
- Estimated spend is $4.92 to $9.11. That is real money, so it needs the curator's approval, which I do not have. Please also define "Path B" (the report compares against it without saying what it is).

---

## 3. Conditions before the live re-run

1. Pass the hold-out in 2.1 (the "demote" and "keep" lists) and report the result; list the demoted-with-vegan-in-note rows for L4C-1 or the curator.
2. Extend the L4C-1 audit to the four checks in 2.2 and apply it to all surviving vegan stances.
3. Relabel legacy `search_status` as unknown (2.3) and report the 97.
4. Deliver the row-level flags file (2.5).
5. Resolve `artist_type` deterministically first and re-size 4C (2.6); define Path B.
6. The curator approves the Stage 4C spend. Until then, no paid call.

Everything else in the report is accepted as written: the stance split, the two-tier conflicts, the calibrated safe counts (country 243, first year 230, last year 227; these will be shown in a per-artist review, not applied in bulk), the catalogue-bounds separation and the plausibility guards. Keep following the additive-only compatibility contract in `docs/ARTIST_ENRICHMENT_V2_MAIN_PROJECT_REPLY.md`.

---

## 4. Round 2: review of the revised report and `docs/dryrun_flags.csv` (2026-11-27)

**Verdict: good to proceed to the next step, with two small deterministic fixes and a pilot first. The full paid Stage 4C run waits for the curator's spend approval.**

**All six conditions from section 3 were addressed**, and I verified the file against the report and the live table: 1,358 rows; 58 demotions (38 + 20, disjoint); 37 stripped member flags; 20 + 37 catalogue disagreements; 337 + 53 = 390 artist types; 97 non-search and 109 no-URL rows; 4 + 5 orphans/fixtures; 4 + 2 collisions' worth of rows. Every hold-out and weak-survivor artist I named is in the L4C-1 queue (17 of 17), and all 20 demoted-with-"vegan"-in-note rows are in it. The 14 of 14 demote/keep hold-out result is credible, and the report honestly marks 263 as a FAIL. Path A / Path B are now defined and the Path A estimate fell from $4.92-$9.11 to $2.18-$4.30 once `artist_type` stopped driving L4C-2.

### Two fixes to make before the pilot

1. **The member-level vegan gate has a hole (confirmed: 263 Boogie Down Productions).** KRS-One keeps `vegan: true` on the note "Longtime vegetarian and plant-based advocate...", which contains no vegan evidence, and that flag is what keeps the band at `VEGAN_MEMBERS`. By the same approximation I used earlier, at least 13 `vegan: true` flags survive with a note that lacks the word "vegan", and about seven are plainly vegetarian-only: 263 KRS-One, 373 Vic DiCara, 3743 Beki Bondage, 3597 Tomas Squip, 3625 Dick Lucas, 1475 Ray Cappo, 237 Nina Hagen. The others (190 two XVX members, 243, 3754, 3923, 24383) have a note with no vegan claim at all. Please make the rule member-scoped: a member keeps `vegan: true` only if that member's own evidence note, or a snippet attached to that member, says vegan. Also fix the report's hold-out table: it says 263's note does not mention vegan, but the stance note does ("vegetarian and vegan advocate").
2. **`artist_type` inference misfires on cue-based rules.** The `members_count>=2` rule (170 rows) looks clean: none of those bios opens as a single individual. The `bio_group_cue` rule (95 rows) does not: about 8 open as one person, for example 3648 Andrea Čengić, 3737 Connor Dickson, 3739 Micheal Kearney, 3740 Sam Crocker, 3736 Caitlyn Day, 3741 Sophie Wilcher, and the "solo music project" bios 100 Vystopia and 103 Vanquish Evil (the word "project" or a mention of "the bands X and Y" is being read as a group cue). That is roughly 9 wrong of the 99 cue-based Group inferences. Please tighten the cue (ignore band names after "member of / work with / known for"; "solo project" is a Person) and store inferred types with a source such as `INFERRED_BIO` and a lower confidence than MusicBrainz's `type`. Note that the 89 known `Person` rows are not a fair test of the members rule: the null rows are the ones MusicBrainz could not type, and their member lists come from the AI step, which often lists the band of a credited vocalist.

### Pilot before the full run
Stage 4C-1 is untested on the four weak cases that the word-presence gate lets through (promotes vs is, band vs member, subject attachment, time scope). Before the full 366-row audit, run it on a pilot of about 30 rows (a few cents) and report the result: 163, 192, 240, 243, 316 (promotes vs is), 3776 (member vs band), 3618 (subject attachment), 211 (time scope), the 6 "unclear" hold-outs (263, 431, 487, 3560, 3698, 24367), and 10 of the clear keeps. Expected: the first five downgraded to thematic or animal-rights, 3776 to `VEGAN_MEMBERS`, 3618 and 211 flagged, and the clear keeps unchanged. Proceed to the full run only if it behaves.

### Smaller points
- `HIGH_CORROBORATED` country (40 rows): please say which source pairs count as independent. MusicBrainz and Wikidata often derive from each other, so only an independent pair (for example MusicBrainz + Bandcamp location) should lift a row to HIGH.
- The CSV has 6 duplicate rows; harmless.
- Keep `first_release_year` and `last_release_year` HIGH-corroborated at 0 until the Bandcamp backfill lands, as the report says.
