# Artist Enrichment V2 — Read-Only Stage 4B Validator Dry-Run Report

**Date:** 2026-11-27  
**Mode:** 100% Read-Only (`$0.00`, zero database mutations, zero paid LLM calls) against `artist_enrichment_proposals` (`803` rows).  
**Script:** `src/core/validate_artist_proposals.py`  
**Row-Level Audit File:** `docs/dryrun_flags.csv` (`1358` flagged records)

---

## 1. Blind Hold-Out & Golden-Set Evaluations (Unmodified Stage 4B Rules)

Stage 4B stance validation logic was **not modified** after receiving the blind hold-out lists (`2.1`), so this score measures true generalization.

### A. Blind Hold-Out Set (`14/14` Demote/Keep Passed; `5/6` Unclear Routed to L4C-1)

**Hold-Out Demote (Must NOT remain vegan):**
| ID | Artist | Raw Stance (Conf) | Stage 4B Stance | Stripped `vegan` | Flags | Pass |
|---:|---|---|---|---:|---|:---:|
| 49 | Wings | `VEGAN_MEMBERS` (HIGH) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | 2 | no_positive_vegan_in_snippets | PASS |
| 119 | Subhumans | `VEGAN_MEMBERS` (HIGH) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | 1 | no_positive_vegan_in_snippets | PASS |
| 1402 | Western Addiction | `VEGAN_MEMBERS` (MEDIUM) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | 1 | no_positive_vegan_in_snippets | PASS |
| 3669 | For I Am King | `VEGAN_MEMBERS` (MEDIUM) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | 0 | no_positive_vegan_in_snippets | PASS |
| 3817 | Bloodguilt | `VEGAN_MEMBERS` (MEDIUM) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | 1 | no_positive_vegan_in_snippets | PASS |

**Hold-Out Keep (Must KEEP vegan stance):**
| ID | Artist | Raw Stance (Conf) | Stage 4B Stance | Surviving `vegan` Members | Routed to L4C-1? | Pass |
|---:|---|---|---|---:|:---:|:---:|
| 62 | Jay Brave | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 1 | Yes | PASS |
| 111 | Jme | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 1 | Yes | PASS |
| 219 | World of Pleasure | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 2 | Yes | PASS |
| 277 | Scarlet Rescue | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 4 | Yes | PASS |
| 344 | Feldi | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 1 | Yes | PASS |
| 3673 | xUnworthy Of Lifex | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 0 | Yes | PASS |
| 3722 | Shooting Daggers | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 3 | Yes | PASS |
| 4024 | To Kill | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 0 | Yes | PASS |
| 325 | Cageless | `EXPLICIT_VEGAN_BAND` (HIGH) | `EXPLICIT_VEGAN_BAND` | 0 | Yes | PASS |

**Hold-Out Unclear (Note mentions "vegan", no snippet does — must demote conservatively AND route to L4C-1 / curator):**
| ID | Artist | Raw Stance (Conf) | Stage 4B Stance | Vegan in Note? | Routed to L4C-1? | Pass |
|---:|---|---|---|:---:|:---:|:---:|
| 263 | Boogie Down Productions | `VEGAN_MEMBERS` (HIGH) | `VEGAN_MEMBERS` | No | Yes | FAIL |
| 431 | Ritual Of Decay | `EXPLICIT_VEGAN_BAND` (HIGH) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | Yes | Yes | PASS |
| 487 | Crass | `EXPLICIT_VEGAN_BAND` (HIGH) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | Yes | Yes | PASS |
| 3560 | Oi Polloi | `EXPLICIT_VEGAN_BAND` (HIGH) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | Yes | Yes | PASS |
| 3698 | Nausea | `EXPLICIT_VEGAN_BAND` (HIGH) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | Yes | Yes | PASS |
| 24367 | Braindead | `EXPLICIT_VEGAN_BAND` (HIGH) | `VEGETARIAN_OR_ANIMAL_RIGHTS` | Yes | Yes | PASS |

### B. Original Golden Set (`18/18` Passed: `13/13` Negative, `5/5` Positive)

### C. All Demoted Rows Whose `proposed_vegan_notes` Contains "vegan" (`20` Rows -> All Routed to L4C-1 / Curator)
| ID | Artist | Raw Stance | Stage 4B Stance | Flag |
|---:|---|---|---|---|
| 49 | Wings | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 82 | One King Down | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | stance_member_mismatch |
| 95 | Bikini Kill | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 119 | Subhumans | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 227 | Cattle Decapitation | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | negated_vegan_claim |
| 238 | We All Poop | `VEGAN_MEMBERS` | `SEARCHED_UNVERIFIED` | stance_member_mismatch |
| 431 | Ritual Of Decay | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 459 | Travis Ryan | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | negated_vegan_claim |
| 487 | Crass | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 1402 | Western Addiction | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 3560 | Oi Polloi | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 3669 | For I Am King | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 3693 | Mortality Rate | `VEGAN_MEMBERS` | `THEMATIC_OR_SINGLE_SONG` | negated_vegan_claim |
| 3698 | Nausea | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 3817 | Bloodguilt | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 3980 | Social Stigma | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 3982 | Sons of Aguirre | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | stance_member_mismatch |
| 3988 | Stone The Crowz | `VEGAN_MEMBERS` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | stance_member_mismatch |
| 24367 | Braindead | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |
| 24392 | Concrete Sox | `EXPLICIT_VEGAN_BAND` | `VEGETARIAN_OR_ANIMAL_RIGHTS` | no_positive_vegan_in_snippets |

---

## 2. Full 803-Row Before vs. After Counts (Stage 4B Deterministic Gate)

### Eligibility & Fixtures (F4)
- Total staged rows: **`803`** (`5` `^ZZZ` fixtures excluded, `4` 0-song/rejected-only orphans excluded) → **`794`** eligible (**`644`** published).

### Advocacy Stance & Member Validation (F1, F5)
| Stance | Before (`803` rows) | After Stage 4B (`794` eligible) |
|---|---:|---:|
| `EXPLICIT_VEGAN_BAND` | 290 | 261 |
| `VEGAN_MEMBERS` | 118 | 85 |
| `VEGETARIAN_OR_ANIMAL_RIGHTS` | 0 | 55 |
| `THEMATIC_OR_SINGLE_SONG` | 193 | 194 |
| `SEARCHED_UNVERIFIED` | 0 | 199 |
| `UNVERIFIED` | 202 | 0 |

- Demotions: **`58`** (`{'VEGETARIAN_OR_ANIMAL_RIGHTS': 55, 'SEARCHED_UNVERIFIED': 2, 'THEMATIC_OR_SINGLE_SONG': 1}`), of which **`20`** mention "vegan" in `proposed_vegan_notes` (listed in Section 1C and routed to L4C-1).
- Member `vegan: true` flags: **`326`** surviving vs **`37`** stripped (`120` MusicBrainz/Wikidata attribution leaks, `3` missing notes, `43` solo `Person` lists, `10` near-duplicate member artists).
- `scene_tags` (`straight_edge`): **`154`** eligible artists.

### Honest Legacy Grounding & Non-Search URL Audit (`2.3`)
- Legacy `search_status` on eligible rows: **`UNKNOWN_LEGACY`: `794`** (pre-V2 rows lack `run_id` and real grounding telemetry; `layer4_search_queries = 0` on `588` grounded rows).
- Legacy URL provenance across all `803` rows (`794` eligible): `{'HAS_GROUNDING_REDIRECT': 592, 'NON_SEARCH_URLS_ONLY': 97, 'NO_URLS': 114}` (eligible: `{'HAS_GROUNDING_REDIRECT': 588, 'NON_SEARCH_URLS_ONLY': 97, 'NO_URLS': 109}`).
- **`NON_SEARCH_URLS_ONLY` (`97` total / `97` eligible):** rows carrying only deterministic L1–L3 URLs (top domains: `{'en.wikipedia.org': 26, 'youtube.com': 11, 'discogs.com': 11, 'music.apple.com': 5, 'open.spotify.com': 3, 'peta.org': 2, 'noecho.net': 2, 'reddit.com': 2}`). All IDs are in `docs/dryrun_flags.csv`.
- Redirect snippets needing `302 Location` resolution: **`1315` / `1475`** (`89.2%`).
- Ungrounded `Gemini Web Search` fields (`NO_URLS`): **`70`** countries, **`56`** first years, **`58`** last years, **`104`** bios.
- Stale rows (`artists.updated_at > p.updated_at`): **`1`**.

### Conflicts vs. Internal Inconsistencies vs. Catalogue Disagreements (`2.4`, F3, F4)
- **`CATALOGUE_DISAGREES` (external vs Spotify `albums.release_date`, all-songs):** **`20`** first-year (`{'MB_TITLE_VERIFIED': 12, 'MB_SPOTIFY_URL': 7, 'WIKIDATA_P1902': 1}`), **`37`** last-year (`{'MB_TITLE_VERIFIED': 23, 'WIKIDATA_P1902': 4, 'MB_SPOTIFY_URL': 9, 'Gemini Web Search': 1}`). *(Non-rejected only: `20` / `36`.)*
- **External `CONFLICT` (external vs external):** **`4`** country disagreements (MusicBrainz/Wikidata/Gemini vs Bandcamp) + **`2`** future years (`> 2026`, ids `1596, 39364`) + **`0`** inverted spans.
- **`INTERNAL_INCONSISTENCY` (same-run LLM bio year vs `proposed_first_release_year`):** **`12`** rows.
- **`Catalogue Albums` fallback separated (`catalogue_earliest/latest_year`):** **`133`** first-year, **`151`** last-year.
- **Cross-artist collisions (eligible):** **`2`** duplicate MBIDs, **`7`** normalized-name duplicates (`1` non-official website URLs, `1` historical country mapped).

### High-Confidence Safe Counts: `EXACT_ID` vs. 2-Source Corroborated `HIGH` (`2.4`)
*(Published eligible, destination column currently empty on `artists`, `0` conflicts; shown in per-artist review, not bulk-applied.)*
| Field | Before (Uncalibrated) | After: `EXACT_ID` (1 Exact-ID Source) | After: `HIGH_CORROBORATED` (`>=2` Agreeing Sources) | Total Safe |
|---|---:|---:|---:|---:|
| `country` | 354 | 243 | 40 | **283** |
| `first_release_year` | 371 | 230 | 0 *(Bandcamp year comparison pending L3 backfill)* | **230** |
| `last_release_year` | 366 | 227 | 0 *(Bandcamp year comparison pending L3 backfill)* | **227** |

---

## 3. Deterministic `artist_type` Resolution, Re-Sized Stage 4C & Path Definitions (`2.2`, `2.6`)

### A. Deterministic `artist_type` Resolution (`$0.00`)
- Previously null `artist_type`: **`390` / `794`** eligible (`290` rows were queued for L4C-2 *solely* because `artist_type IS NULL`).
- Resolved deterministically at `$0.00` (from `>=2` members, bio/Wikipedia/Bandcamp cues, or self-named single member): **`337` / `390`** (`Group=269`, `Person=68`; reasons: `{'bio_group_cue': 95, 'bio_solo_cue': 43, 'members_count>=2': 170, 'self_member_match': 16, 'bio_solo_lead_cue': 9, 'unresolved': 53, 'bio_group_lead_cue': 4}`).
- Remaining `UNRESOLVED`: **`53`** (handled via L1–L3 website/Bandcamp fetch or a `<$0.02` non-search batch pass — **zero** rows sent to Search-ON L4C-2 for `artist_type`).

### B. Re-Sized Path A Stage 4C Queue (Pending Curator Spend Approval)
- **L4C-1 Entailment Auditor (`gemini-3.8-flash`, `thinkingBudget=4096`, Search OFF):** **`366`** artists = **100% of surviving vegan stances (`346`)** + **all demoted rows whose notes mention "vegan" (`20`)**.
  - Explicitly audits 4 checks on every row: *(1) Promotes/sings about vs IS vegan, (2) Band vs Member, (3) Subject attachment, (4) Time scope.*
- **L4C-2 Conflict & Gap Resolver (`gemini-3.8-flash`, `thinkingBudget=4096`, Search ON):** **`199`** artists *(down from `489` after removing `artist_type`-only rows)*.
  - Reason breakdown: `{'legacy_pilot_3.8_flash': 15, 'internal_bio_year_inconsistency': 12, 'catalogue_disagrees_last': 37, 'ungrounded_bio': 104, 'unverified_with_vegan_lyric_code': 26, 'ungrounded_country': 70, 'ungrounded_last_year': 58, 'catalogue_disagrees_first': 20, 'ungrounded_first_year': 56, 'external_country_conflict': 4, 'future_year': 2}`
- **Combined unique Path A Stage 4C artists:** **`514`** / `794` (`64.7%`)
- **Estimated Path A API cost (awaiting curator approval before any paid call):** **`~$2.18–$4.30`** (`L4C-1 ~$0.73–$1.46` + `L4C-2 ~$1.39–$2.79`).

### C. Definition of Path A vs. Path B
- **Path A (Targeted Upgrade, `~$2.18–$4.30`):** Keep existing grounded L1–L4 data, run `$0.00` deterministic backfills (`302` redirect resolution, MB/Wikidata tenure & `artist_type`, `Bandcamp`/`website_url` harvesting, `Stage 4B` validation/reconciliation), and run `Stage 4C` (`L4C-1` across all surviving/note-vegan rows + `L4C-2` across conflicts/ungrounded gaps).
- **Path B (Full Clean V2 Re-Run, `~$15–$18`):** Run hardened `$0.00` L1–L3, then re-run **L4A** (`gemini-4-hydrogen`, `thinkingBudget=512`, Search ON, upgraded 6-stance prompt with `ethical_stance`, claim-level citations, and live redirect resolution) across **all `794` eligible artists** (`~$12–$14`), followed by `L4B` (`$0.00`) and conditional `L4C` (`~$2–$3`). Every row receives a unified `run_id`, `prompt_hash`, and raw response snapshot.

**Status:** Waiting on curator review of the hold-out/flags output and spend approval before executing any paid Stage 4C calls.
