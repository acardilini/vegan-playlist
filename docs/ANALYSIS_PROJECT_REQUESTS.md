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
