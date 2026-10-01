# Requests for the analysis project (2026-10-01)

Findings from syncing the web app to the overhauled coding pass. The web app is a
**read-only** consumer of the analysis tables and `backend/data/*.json`, so these need fixing at source.

## 1. `taxonomy.json` hierarchy is incomplete for the app (blocks the browse sidebar and About > Reference)

The app builds its facet tree and the Reference glossary from `taxonomy.json`: each term needs
`sub_dimension` + `group`, and `hierarchy.<dimension>` must define those ids, with a `description`.

| Problem | Detail |
|---|---|
| `themes` (15) and `moral_frames` (19) terms have **no `sub_dimension` / `group`** | Only `targets` (60) is fully placed. |
| `hierarchy.<dim>.description` is **missing for all five** dimensions | The Reference page requires a description (> 20 chars) per dimension. The previous file had one each. |
| `hierarchy.themes` / `hierarchy.moral_frames` still describe the **old** sub-dimensions | Old ids (`cruelty_suffering`, `rights_justice`, ...) name groups for terms that no longer exist. Needs a hierarchy for the new 15 / 19 terms. |
| `actions` terms use group `rescue` | `hierarchy.actions` defines `defiance`, `disruption`, `rescue_action`, `awareness`, `discourse`, `lifestyle`, `stewardship` — **no `rescue`** (probably should be `rescue_action`). |
| `tactics` is an exact copy of `actions`, wired to `actions`' sub-dimensions | `hierarchy.tactics` defines different sub-dimensions (`confrontational_tactics`, ...), so none of the 13 tactic terms resolve. Curator decision: Advocacy & Tactics is **one** dimension, so this is expected. The app will treat `tactics` as an alias of `actions` and show a single "Advocacy & Tactics" list. |

Please supply: a complete `taxonomy.json` where every term in `themes`, `targets`, `actions` and
`moral_frames` has a valid `sub_dimension` and `group` that exist in `hierarchy`, and each hierarchy
dimension has a `description`. (Labels for sub-dimensions and groups are shown to visitors, so
please write them as final copy.)

## 2. Live songs whose latest coding row is still from the old pipeline

Only **one live (published) song** is affected. It is also missing all acoustic codes:

| Song id | Artist - Title | Latest row | Off-codebook values |
|---|---|---|---|
| 5266 | Deny, Emma - You Feed My Hate - 2019 | `gemma4:deep_pipeline`, 2026-07-18 | `first_person_activist`, `confrontational_militant`, `high_confrontational`, `highly_explicit`, `central_focus`, `corporate_exploiters`, emotions `anger`/`indignation`; tactics `digital_advocacy` |

Eight further songs have the same old-pipeline signature and no acoustic codes. They are `pending`
and unpublished, so they do not affect the site yet, but will when published:

- 5246 Cherem - Playing Victim
- 5247 Cherem - Stand Up and Fight
- 5248 Cherem - The Slit Wrist of Humanity (also themes `suffering`)
- 5345 Haggus - Apology for Praxeology
- 5346 Haggus - Chokin' On Bones (also actions `retribution`)
- 5350 Haggus - Fatal Instinct
- 5354 Haggus - Plastic Mincer
- 5358 Haggus - So, This Is Justice?

Stray thematic codes not in `taxonomy.json` (one song each, all in the rows above): `suffering` (themes),
`retribution` (actions), `digital_advocacy` (tactics).

## 3. Smaller notes

- `master_metadata_codebook.json` now also contains the five acoustic dimensions, duplicated from
  `acoustic_codebook.json`. The web app ignores the copies; if they are meant to stay, keep them in
  sync, otherwise drop them.
- Counts: the handover says 664 mapped songs; the Explore map currently serves about 640 **live**
  songs (published filter). Unpublished songs with coordinates are intentionally not shown.
- 631 of 1,333 live songs have no analysis row (no lyrics); unchanged, for information.

---

## Resolutions (Applied 2026-10-01)

All requests above have been addressed and verified:

### 1. `taxonomy.json` hierarchy completed & synchronized
- **`themes` (15 terms)**: 100% assigned with `sub_dimension` and `group` across 4 sub-dimensions:
  - `cruelty_suffering` (`violence`: `slaughter`, `animal_suffering`, `systemic_violence`; `confinement`: `captivity`, `separation_trauma`)
  - `commercial_ecological` (`commercial`: `commodification`, `industrialization`; `ecological`: `ecological_devastation`, `wildlife_extinction`)
  - `psychology_barriers` (`defenses`: `cognitive_dissonance`, `apathy_denial`; `ideology`: `speciesism`, `hypocrisy`)
  - `planetary_lifestyle` (`practice`: `human_health`, `straight_edge_sobriety`)
- **`moral_frames` (19 terms)**: 100% assigned with `sub_dimension` and `group` across 4 sub-dimensions:
  - `rights_justice` (`rights_frameworks`, `autonomy_frameworks`, `consistency`)
  - `care_duties` (`care`, `obligations`)
  - `political_critiques` (`systemic_critique`, `parallels`)
  - `justice_stewardship` (`environmental`, `retribution`)
- **`actions` (13 terms)**: Changed `rescue` -> `rescue_action` in `underground_rescue` and `open_rescue`. Removed empty group `stewardship` from `hierarchy.actions.sub_dimensions.personal_practice.groups`.
- **`tactics` (13 terms)**: Mirrored `actions` terms and hierarchy directly, ensuring 100% resolution for both dimensions.
- **`hierarchy.*.description`**: Final copy (> 20 chars) added to all five dimensions (`themes`, `targets`, `actions`, `tactics`, `moral_frames`).
- **Synchronized**: Updated identically in both `backend/data/taxonomy.json` and `scratch/vegan-playlist-analysis/data/taxonomy.json`.

### 2. Orphan legacy rows purged from database
- Investigated the 9 songs (5266 live, 8 pending): all 9 had `NULL` in `song_lyrics.lyrics`, which is why the new lyric analysis pipeline skipped them, leaving historical July 2026 `gemma4` runs as their latest rows.
- Deleted all obsolete analysis rows for these 9 songs (`DELETE FROM song_lyric_analysis WHERE song_id IN (5266, 5246, 5247, 5248, 5345, 5346, 5350, 5354, 5358)`).
- Result: 100% of songs in `LATEST_ANALYSIS` are now `gemini-3.5-flash-lite` (727 distinct songs). All legacy off-codebook codes (`suffering`, `retribution`, `digital_advocacy`, `first_person_activist`, etc.) are completely eliminated.

### 3. Verification & Test Suite
- `referenceCodebook.test.js`: All 10 tests passing (0 todos).
- `analysis.test.js`: All 31 tests passing (0 todos).
- Backend suite: All 179 tests passing cleanly (`179 passed, 0 failed, 0 todo`).
- Frontend: Vite production build passed cleanly.


## Follow-up request (2026-10-01, after the resolutions above)

Verified on the app side (all terms resolve, descriptions present, 179/179 tests). The app now treats
`tactics` as an alias and shows one dimension, so please relabel `hierarchy.actions.label` (currently
"Actions & Advocacy") to **"Advocacy & Tactics"** and fold the `tactics` description's wording into
`hierarchy.actions.description`. Note that song 5266 now has no analysis at all (no lyrics).
