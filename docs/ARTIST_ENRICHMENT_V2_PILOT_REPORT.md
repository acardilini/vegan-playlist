# Artist Enrichment V2 — Deterministic Backfill & Stage 4C Pilot Report

**Date:** 2026-11-27  
**Run IDs:**
- `$0.00` V2 Backfill (`794` eligible rows): `4a7234c5-1ba9-4ee3-923f-0e9b07d5b93f` (`pipeline_version = 'v2.0-stage4b'`)
- Stage 4C Pilot (`24` L4C-1 + `6` L4C-2): `696cf973-1128-475e-80dc-6aed6f983ac6` (`gemini-3.8-flash`, `thinkingBudget = 4096`)

**Total Pilot Cost:** **`$0.30418`** (`48,559` input / `12,179` output / `59,225` thought tokens)  
**Option A Invariant Verified:** `artists` (`bio/notes = 0`), `artist_members` (`10` rows), and `artist_enrichment_review` (`6` rows) remain completely untouched.

---

## 1. Round-2 Deterministic Fixes & `$0.00` Backfill Summary (`794` Eligible Rows)

### A. Round-2 Fixes Verified Before Pilot
1. **Member-level vegan gate (`POSITIVE_MEMBER_VEGAN_RE`, excludes bare `"plant-based"` and LLM `claim` text):**
   - Blind Hold-Out: **`14/14`** demote/keep PASS + **`6/6`** unclear routed to L4C-1 PASS (`263` Boogie Down Productions now demoted to `VEGETARIAN_OR_ANIMAL_RIGHTS` with KRS-One marked `VEGETARIAN`, `vegan = false`).
   - Golden Set: **`18/18`** PASS (`13/13` negative, `5/5` positive).
   - Round-2 vegetarian member check: `263` KRS-One, `373` Vic DiCara, `3743` Beki Bondage, `3597` Tomas Squip, `3625` Dick Lucas, `1475` Ray Cappo & John Porcell, and `237` Nina Hagen all had false `vegan: true` stripped.
2. **Tightened `artist_type` inference (`INFERRED_MEMBERS` / `INFERRED_BIO`):**
   - `0/8` misfires on the named Round-2 cases (`3648, 3737, 3739, 3740, 3736, 3741, 100, 103` — none wrongly marked `Group`).

### B. `$0.00` Backfill Execution (`src/core/backfill_artist_v2.py`)
- **Additive schema migration (`src/core/setup_artist_db.py`):** Added `artist_enrichment_runs`, `artist_enrichment_snapshots`, positive-inclusion `ELIGIBLE_ARTISTS_WHERE`, and 25 additive columns on `artist_enrichment_proposals`.
- **Redirect URL resolution:** **`1,311 / 1,311` (`100.0%`)** unique `vertexaisearch` redirects resolved via `302 Location`, updating `evidence_urls`, `evidence_snippets[].url`, and `evidence_sources`.
- **Bandcamp release-span fetch:** **`198 / 204`** Bandcamp `/music` pages fetched (`$0.00`), lifting **`53`** countries to independent 2-source `HIGH` corroboration.
- **Future-year MusicBrainz repair:** Dropped future/null releases on **`1596`** Fear Factory (`1992–2026`, `2` dropped) and **`39364`** Julien Baker (`2015–2026`, `1` dropped).
- **Hygiene & separation:** Separated **`133`** first-year and **`151`** last-year `Catalogue Albums` values into `catalogue_earliest_year` / `catalogue_latest_year`; cleared **`70`** ungrounded countries, **`56`** ungrounded first years, **`58`** ungrounded last years, and **`1`** non-official website (`myspace.com`).
- **Post-backfill stance distribution (`794` eligible rows):** `EXPLICIT_VEGAN_BAND = 253`, `VEGAN_MEMBERS = 79`, `VEGETARIAN_OR_ANIMAL_RIGHTS = 68`, `THEMATIC_OR_SINGLE_SONG = 193`, `SEARCHED_UNVERIFIED = 201` (`269` rows updated atomically).

---

## 2. Stage 4C-1 Entailment Auditor Pilot (`24` Rows, Search OFF)

| Group | ID | Artist | Before (Post-4B) | After (L4C-1) | Conf | pvi / bvm / subj / time | Outcome vs Expected |
|---|---:|---|---|---|---|---|---|
| Promotes vs Is | 163 | Icons Of Filth | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | HIGH | `PROMOTES_OR_SINGS_ABOUT_ONLY` / `NOT_APPLICABLE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** (downgraded) |
| Promotes vs Is | 192 | Abattoirblues | `EXPLICIT_VEGAN_BAND` | `THEMATIC_OR_SINGLE_SONG` | MEDIUM | `PROMOTES_OR_SINGS_ABOUT_ONLY` / `NOT_APPLICABLE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** (downgraded) |
| Promotes vs Is | 240 | Most Precious Blood | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | MEDIUM | `PROMOTES_OR_SINGS_ABOUT_ONLY` / `NOT_APPLICABLE` / `DIRECT_QUOTE` / `UNCLEAR` | **PASS** (downgraded) |
| Promotes vs Is | 243 | Michael Harren | `VEGETARIAN_OR_ANIMAL_RIGHTS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | HIGH | `VEGETARIAN_OR_AR_ONLY` / `SOLO_ARTIST` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** (verified AR) |
| Promotes vs Is | 316 | Tribunal Animal | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | HIGH | `PROMOTES_OR_SINGS_ABOUT_ONLY` / `NOT_APPLICABLE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** (downgraded) |
| Member vs Band | 3776 | Hour of Reprisal | `EXPLICIT_VEGAN_BAND` | `VEGAN_MEMBERS` | MEDIUM | `IS_VEGAN` / `SPECIFIC_MEMBERS_ONLY` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** (Mike verified) |
| Subject Attach | 3618 | Cho-Beat | `VEGETARIAN_OR_ANIMAL_RIGHTS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | MEDIUM | `VEGETARIAN_OR_AR_ONLY` / `SOLO_ARTIST` / `WEAK_HANDLE_OR_URL_ONLY` / `CURRENT_OR_ONGOING` | **PASS** (flagged weak handle) |
| Time Scope | 211 | Arkangel | `EXPLICIT_VEGAN_BAND` | `THEMATIC_OR_SINGLE_SONG` | MEDIUM | `PROMOTES_OR_SINGS_ABOUT_ONLY` / `BAND_WIDE` / `DIRECT_QUOTE` / `HISTORICAL_ERA_ONLY` | **PASS** (`early_era_only`) |
| Unclear Hold-Out | 263 | Boogie Down Productions | `VEGETARIAN_OR_ANIMAL_RIGHTS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | MEDIUM | `VEGETARIAN_OR_AR_ONLY` / `SPECIFIC_MEMBERS_ONLY` / `DIRECT_QUOTE` / `HISTORICAL_ERA_ONLY` | **PASS** (KRS-One veg) |
| Unclear Hold-Out | 431 | Ritual Of Decay | `VEGETARIAN_OR_ANIMAL_RIGHTS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | HIGH | `VEGETARIAN_OR_AR_ONLY` / `BAND_WIDE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** (confirmed AR) |
| Unclear Hold-Out | 487 | Crass | `VEGETARIAN_OR_ANIMAL_RIGHTS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | HIGH | `VEGETARIAN_OR_AR_ONLY` / `BAND_WIDE` / `DIRECT_QUOTE` / `UNCLEAR` | **PASS** (confirmed AR) |
| Unclear Hold-Out | 3560 | Oi Polloi | `VEGETARIAN_OR_ANIMAL_RIGHTS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | HIGH | `VEGETARIAN_OR_AR_ONLY` / `BAND_WIDE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** (confirmed AR) |
| Unclear Hold-Out | 3698 | Nausea | `VEGETARIAN_OR_ANIMAL_RIGHTS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | MEDIUM | `VEGETARIAN_OR_AR_ONLY` / `BAND_WIDE` / `DIRECT_QUOTE` / `HISTORICAL_ERA_ONLY` | **PASS** (confirmed AR) |
| Unclear Hold-Out | 24367 | Braindead | `VEGETARIAN_OR_ANIMAL_RIGHTS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | HIGH | `VEGETARIAN_OR_AR_ONLY` / `BAND_WIDE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** (confirmed AR) |
| Clear Keep | 81 | **Earth Crisis** | `EXPLICIT_VEGAN_BAND` | **`VEGETARIAN_OR_ANIMAL_RIGHTS`** | MEDIUM | `PROMOTES_OR_SINGS_ABOUT_ONLY` / `BAND_WIDE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **FALSE DEMOTION** (see Finding #1) |
| Clear Keep | 3694 | Motionless In White | `VEGAN_MEMBERS` | `VEGAN_MEMBERS` | HIGH | `IS_VEGAN` / `SPECIFIC_MEMBERS_ONLY` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |
| Clear Keep | 3614 | Cenizas | `EXPLICIT_VEGAN_BAND` | `EXPLICIT_VEGAN_BAND` | MEDIUM | `IS_VEGAN` / `BAND_WIDE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |
| Clear Keep | 354 | Homeboy Sandman | `EXPLICIT_VEGAN_BAND` | `EXPLICIT_VEGAN_BAND` | MEDIUM | `IS_VEGAN` / `SOLO_ARTIST` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |
| Clear Keep | 3691 | Megadeth | `VEGAN_MEMBERS` | `VEGAN_MEMBERS` | HIGH | `IS_VEGAN` / `SPECIFIC_MEMBERS_ONLY` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |
| Clear Keep | 62 | Jay Brave | `EXPLICIT_VEGAN_BAND` | `EXPLICIT_VEGAN_BAND` | HIGH | `IS_VEGAN` / `SOLO_ARTIST` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |
| Clear Keep | 111 | Jme | `EXPLICIT_VEGAN_BAND` | `EXPLICIT_VEGAN_BAND` | HIGH | `IS_VEGAN` / `SOLO_ARTIST` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |
| Clear Keep | 219 | World of Pleasure | `EXPLICIT_VEGAN_BAND` | `EXPLICIT_VEGAN_BAND` | HIGH | `IS_VEGAN` / `BAND_WIDE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |
| Clear Keep | 277 | Scarlet Rescue | `EXPLICIT_VEGAN_BAND` | `EXPLICIT_VEGAN_BAND` | HIGH | `IS_VEGAN` / `BAND_WIDE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |
| Clear Keep | 3722 | Shooting Daggers | `EXPLICIT_VEGAN_BAND` | `EXPLICIT_VEGAN_BAND` | HIGH | `IS_VEGAN` / `BAND_WIDE` / `DIRECT_QUOTE` / `CURRENT_OR_ONGOING` | **PASS** |

**L4C-1 Score:** **`23 / 24` (`95.8%`)** — all 8 weak-evidence test cases + all 6 unclear hold-outs + 9/10 clear keeps behaved accurately.

---

## 3. Stage 4C-2 Conflict & Gap Resolver Pilot (`6` Rows, Search ON)

| ID | Artist | Resolution | Years (After) | Stance (After) | New Resolved URLs | Key Finding |
|---:|---|---|---|---:|---:|---|
| 1664 | ManLiftingBanner | `CONFIRMED_EXTERNAL_CORRECT_CATALOGUE_IS_REISSUE` | `2014–2014` *(see Finding #2)* | `VEGETARIAN_OR_ANIMAL_RIGHTS` | 3 | Found 1991 debut EP *Myth of Freedom* & 1995 compilation vs MB's 2014 *Red Fury*. |
| 163 | Icons Of Filth | `CONFIRMED_EXTERNAL_CORRECT_CATALOGUE_IS_REISSUE` | `1983–2026` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | 3 | Confirmed Spotify's 1977 date is a metadata error; MB's 1983 is accurate. |
| 3625 | Culture Shock | `WRONG_MBID_IDENTITY_CORRECTED` | **`1986–2026`** | `VEGETARIAN_OR_ANIMAL_RIGHTS` | 4 | Caught wrong Drum & Bass MBID (2004) and corrected to Dick Lucas's band (`1986–2026`). |
| 3844 | Fall Of Efrafa | `CONFIRMED_EXTERNAL_CORRECT_CATALOGUE_IS_REISSUE` | `2006–2009` | `EXPLICIT_VEGAN_BAND` | 2 | Confirmed 2005–2009 trilogy vs 2021 posthumous demo/reissue; cited `"We're all vegan..."` interview. |
| 320 | FranCisco | `GAP_FILLED` | `2019–2019` | **`THEMATIC_OR_SINGLE_SONG`** | 3 | Identified featured credit on Guydence's *Vegang* with no personal vegan confirmation. |
| 59 | Kenny Davis | `GAP_FILLED` | `2018–2018` | **`THEMATIC_OR_SINGLE_SONG`** | 3 | Distinguished vocalist on *The Vegan Song* from jazz bassist Kenny Davis; no personal vegan confirmation. |

---

## 4. Two Concrete Findings to Fix Before Full Path A Drain

1. **Finding #1 — Search-OFF L4C-1 falsely demoted `81` Earth Crisis (`"note_claims_vegan_without_snippet"`):**
   - L4C-1 obeyed its literal-snippet prompt faithfully: Earth Crisis's two stored snippets said *"promoting a straight edge and vegan lifestyle"* and *"mouthpiece of America's militant vegan straight-edge movement"* without quoting Karl Buechner or the members personally.
   - **Fix before full drain:** Whenever L4C-1 (Search OFF) outputs `note_claims_vegan_without_snippet` or downgrades an `EXPLICIT_VEGAN_BAND` whose `proposed_vegan_notes` / `proposed_bio` explicitly states band-wide veganism, automatically route that row to **L4C-2 (Search ON)** to seek a direct primary quote confirming or refuting personal veganism instead of silently demoting flagship vegan bands!
2. **Finding #2 — `L4C2_SCHEMA` lacked an `"EXTERNAL_INCOMPLETE_CORRECTED"` enum value (`1664` ManLiftingBanner):**
   - On `1664`, L4C-2 found the exact `1991` Discogs debut EP (*Myth of Freedom*) and `1995` compilation (*We Will Not Rest*), but because `proposed_first_release_year` only overwrote under `WRONG_MBID_IDENTITY_CORRECTED`, `proposed_first_release_year` stayed `2014`.
   - **Fix before full drain:** Add `"EXTERNAL_INCOMPLETE_CORRECTED"` to `L4C2_SCHEMA` and allow grounded `proposed_first/last_release_year` updates under both `WRONG_MBID_IDENTITY_CORRECTED` and `EXTERNAL_INCOMPLETE_CORRECTED`.

---

## 5. Next Step & Projected Remaining Spend

- **Pilot spend:** **`$0.30418`** (`~30` calls).
- **Path A remains dramatically cheaper and cleaner than Path B** (`~$15–$18`), and the Stage 4C-1 + 4C-2 architecture proved both effective (`23/24` L4C-1 + `6/6` L4C-2 grounded resolutions) and easily tunable via the two fixes above.
- **Projected remaining Path A full drain** (`~342` remaining L4C-1 + `~193` remaining L4C-2 + any L4C-1->L4C-2 escalations like Earth Crisis): **`~$3.50–$5.50`** on `gemini-3.8-flash` (`thinkingBudget = 4096`).
- **Awaiting curator / main-project sign-off** to apply Findings #1 and #2 and execute the remaining Path A Stage 4C drain.
