# Response to Artist Enrichment Data Review (`vegan-playlist-analysis` → `vegan-playlist`)

**Date:** 2026-11-27  
**From:** `vegan-playlist-analysis`  
**In response to:** `docs/ARTIST_ENRICHMENT_DATA_REVIEW.md`  
**Invariant:** Option A remains strictly unchanged — `vegan-playlist-analysis` never writes to `artists` or `artist_members`.

---

## 1. Summary & Root-Cause Confirmation

We accept the review’s verdict and priority ordering in full. Auditing our scripts (`src/core/setup_artist_db.py`, `src/core/collect_artist_facts.py`, `src/core/research_artists_gemini.py`) against your findings confirmed the exact root causes behind the P0/P1 issues:

- **F1 (Vegetarian filed as vegan):** Our Layer 4 prompt explicitly told the model to place *"vegan/vegetarian/animal-rights advocates"* under `VEGAN_MEMBERS` with `"vegan": true`, and ran single-pass with `thinkingBudget=0` and no entailment check against snippets or the member list.
- **F2.1–F2.2 (Broken search counter & opaque redirects):** We counted only `groundingMetadata.webSearchQueries` (which `gemini-4-hydrogen` frequently omits even when `groundingChunks` are populated) and stored raw `vertexaisearch.cloud.google.com/grounding-api-redirect/...` URIs without resolving `302 Location` headers or storing chunk titles/retrieval timestamps.
- **F2.3–F2.5 (Ungrounded answers, uncalibrated confidence, row-level attribution):** Model-memory answers with zero evidence URLs were still labeled `Gemini Web Search` (`MEDIUM`), `advocacy_confidence` was model self-reported, `MB_TITLE_VERIFIED` was marked `HIGH` on single-title matches, and Layer 4 flipped `vegan = true` directly onto MusicBrainz member dicts without per-attribute attribution.
- **F3.1–F3.4 (Contradictions, `2027` years, `Catalogue Albums` fallback):** `valid_year()` permitted `CURRENT_YEAR + 1`, `resolve_mbid_via_title_search()` accepted any shared title `>= 4` chars without year/generic-title checks, Layer 3 wrote `db_min_year`/`db_max_year` directly into `proposed_first/last_release_year`, and no cross-source or bio-vs-year reconciler ran.
- **F4 (Fixtures & collisions):** `ELIGIBLE_ARTISTS_WHERE` used a double-negation (`NOT (EXISTS ... AND NOT EXISTS ...)`) that evaluated `TRUE` for 0-song orphan/test records (`ZZZWB...`), and no cross-row collision detector checked shared MBIDs or normalized name duplicates.

---

## 2. Planned Artist Enrichment V2 Changes (Mapped to P0 / P1 / P2)

### P0 — Curator Safety, Verification & Reconciliation

1. **Separated Stance & Ethical Taxonomies (F1):**
   - Expand `artist_vegan_stance` to 6 distinct values:
     - `EXPLICIT_VEGAN_BAND` — band or solo artist explicitly identifies as vegan or vegan straight-edge.
     - `VEGAN_MEMBERS` — at least one named member is explicitly confirmed **vegan** (never merely vegetarian).
     - `VEGETARIAN_OR_ANIMAL_RIGHTS` — confirmed vegetarian, pescatarian, *"mostly vegan / cheats"*, or animal-rights advocacy without confirmed veganism (e.g., Cattle Decapitation, Bikini Kill, Paul McCartney).
     - `THEMATIC_OR_SINGLE_SONG` — general/non-vegan artist addressing animal-rights/vegan themes in song(s) without broader personal advocacy.
     - `SEARCHED_UNVERIFIED` — web search executed, insufficient reliable evidence found.
     - `NOT_SEARCHED` — Layer 4 has not run or search did not execute.
   - Replace boolean-only member tagging with per-member **`ethical_stance`** (because veganism is an ethic, not a diet):
     - `VEGAN` | `VEGETARIAN` | `ANIMAL_RIGHTS_ADVOCATE` | `EXPLICITLY_NOT_VEGAN` | `UNKNOWN`
     - Only verified `ethical_stance = 'VEGAN'` maps to `vegan: true`, and only when backed by a resolved URL + positive quoted snippet attached to that specific member.
2. **Multi-Stage / Multi-Agent Pipeline Architecture:**
   - **Hardened L1–L3 (`$0.00`):** Deterministic archive & first-party harvesting (Wikidata, MusicBrainz, Bandcamp, official websites, Wikipedia).
   - **L4A Primary Researcher (`gemini-4-hydrogen`, `thinkingBudget=512`, Google Search enabled):** Upgraded prompt with explicit negative few-shot examples (Cattle Decapitation, Bikini Kill, Paul McCartney → `VEGETARIAN_OR_ANIMAL_RIGHTS`), mandatory `artist_type`, and strict grounding rules (return `null` instead of guessing from memory when search yields no source).
   - **L4B Deterministic Validator, Normalizer & Reconciler (`$0.00`):** Runs between model JSON output and staging writes. Enforces snippet-to-subject entailment gates (rejecting negations like *"not vegan"*, *"occasionally cheat"*, *"vegetarian, not vegan"*), bidirectional stance-vs-members consistency, year bounds, member canonicalization, and cross-source/catalogue conflict detection.
   - **L4C Conditional Adversarial Verifier (`gemini-3.8-flash`, `thinkingBudget=4096`; escalating persistent deadlocks to `gemini-4-neon`, `thinkingBudget=2048`):**
     - *L4C-1 Entailment Auditor (Search OFF):* Inspects flagged `EXPLICIT_VEGAN_BAND` / `VEGAN_MEMBERS` rows using only the claim, members, and quoted snippets to verify literal entailment without confirmation bias.
     - *L4C-2 Conflict & Gap Resolver (Search ON):* Resolves `CONFLICT` rows (distinguishing Spotify reissue/compilation lag from wrong MBID matches), bio-vs-year gaps, ungrounded bios/countries, and `SEARCHED_UNVERIFIED` artists whose lyrics strongly signal explicit vegan advocacy.
3. **Cross-Source & Catalogue Reconciliation (`field_conflicts JSONB`) & Plausibility Guards (F3.1–F3.4):**
   - Reconcile Wikidata, MusicBrainz, Bandcamp, official websites, Gemini, `albums.release_date`, and years extracted from `proposed_bio` (flagging gaps `> 12` years).
   - Any contradiction emits a per-field `CONFLICT` status carrying both values, sources, and evidence, disqualifying that field from bulk-approval.
   - Cap all years strictly at `[1900, CURRENT_YEAR]` (eliminating `2027` pre-release entries) and enforce `first_release_year <= last_release_year`.
4. **Resolved Evidence URLs & Fixed Grounding Telemetry (F2.1–F2.2):**
   - Resolve `vertexaisearch` redirects at collection time via HTTP `allow_redirects=False` (`302 Location`), storing structured `evidence_sources` entries: `{final_url, redirect_url, page_title, domain, retrieved_at, http_status}` and rewriting `evidence_snippets[].url` to `final_url`.
   - Record `grounding_queries TEXT[]`, `grounding_chunk_count`, `grounding_supports_count`, and explicit `search_status` (`NOT_SEARCHED` | `SEARCHED_NO_RESULTS` | `SEARCHED_WITH_RESULTS` | `MEMORY_ONLY`).
5. **Eligibility Fixes, Tightened MBID Matching & Collision Detection (F4):**
   - Switch `ELIGIBLE_ARTISTS_WHERE` to positive inclusion (`>= 1` non-rejected song) and exclude test fixtures (`a.name !~* '^ZZZ'`).
   - Tighten `MB_TITLE_VERIFIED` to require either `>= 2` distinct matching titles or a non-generic release title (`>= 6` chars, excluding stoplisted titles like `demo`, `live`, `ep`, `intro`) with plausible year alignment; store `mbid_match_evidence JSONB` (`matched_title`, `mb_rg_id`, `artist_credit`, `score`, `year_delta`).
   - Run a post-batch cross-artist collision check (`identity_collisions JSONB`) surfacing shared `proposed_musicbrainz_id`, `proposed_wikidata_qid`, `proposed_bandcamp_url`, and normalized duplicate artist names.

### P1 — Auditability, Provenance & Reproducibility

1. **Rule-Derived Confidence Engine (F2.4):**
   - Replace model self-reported confidence with deterministic rules:
     - `EXACT_ID`: Curated `EXISTING`, Wikidata `P1902`, or `MB_SPOTIFY_URL` with `0` conflicts.
     - `HIGH`: `>= 2` independent agreeing grounded sources with `0` conflicts (or Stage 4C-verified advocacy backed by resolved sources and `0` contradictions).
     - `MEDIUM`: Single grounded external source (resolved URL, Bandcamp alone, or non-conflicting `MB_TITLE_VERIFIED`).
     - `LOW`: Single hedged mention or ungrounded parametric answer (never labeled `Gemini Web Search` as grounded, never bulk-offered).
     - `CONFLICT`: Cross-source or catalogue contradiction (quarantined for curator decision).
2. **Per-Attribute Member Provenance, Canonicalization, Tenure & `artist_type` (F2.5, F5):**
   - Normalize member keys across Unicode hyphens (`U+2010`–`U+2015`), curly quotes, NFKD diacritics, and extract quoted nicknames (`Chris "Motionless" Cerulli` → `aliases: ["Motionless"]`).
   - Extract `start_year` / `end_year` tenure already present in MusicBrainz/Wikidata and L4 sources.
   - Store provenance per attribute (`name_source`, `tenure_source`, `ethical_stance`, `vegan_source`, `vegan_evidence_note`, `vegan_evidence_url`, `vegan_confidence`) and multi-source `bio_sources TEXT[]` + `bio_grounded BOOLEAN`.
   - Require `artist_type` (`Person` | `Group` | `Project`) on `100%` of rows; enforce solo-artist rule (`Person` → `proposed_members = []`, storing legal/birth/stage names in `proposed_aliases`).
3. **Run Lineage & Staleness Tracking (F2.6, F6):**
   - Add append-only `artist_enrichment_runs` (`run_id`, `pipeline_version`, `layer`, `model`, `prompt_hash`, `params_json`, `started_at`, `finished_at`) and `artist_enrichment_snapshots` (`run_id`, `artist_id`, `raw_response_json`, `grounding_metadata_json`, `created_at`) while keeping `artist_enrichment_proposals` as the latest materialized staging view (`last_run_id`).
   - Record `source_artist_updated_at` (copied from `artists.updated_at` at run time) so subsequent curator edits immediately mark proposals stale.

### P2 — Leveraging Existing Assets, Semantics & Coverage Hygiene

1. **Deep Harvesting of Already-Collected Song & Artist Assets (`$0.00` + Disambiguation):**
   - **Bandcamp (`bandcamp_url`):** Beyond `/music` bios, locations, and track lists, parse release tags, album credits, and liner notes already linked via `artists.bandcamp_url` / L1–L3 Bandcamp URLs.
   - **Official Websites (`website_url`):** Fetch existing non-social official artist websites (filtering out MySpace, Facebook, Twitter/X, Instagram, Discogs, etc. from `proposed_website_url`) and parse `/about`, `/bio`, `/discography`, and `/band` pages for releases, origin, and member bios.
   - **Multi-Language Wikipedia:** Follow non-English Wikipedia sitelinks (`de`, `sv`, `es`, `fr`, `it`, `pt`, `ja`) when `enwiki` is absent, and extract relevant body sections (veganism/animal-rights/members/discography), not only the intro summary.
   - **Existing Song-Level Catalogue & Lyric/Audio Analyses (`albums`, `song_lyric_analysis`, `song_audio_analysis`):** Surface compact `catalogue_lyric_signal` context (`advocacy` codes, `themes`, `topics`, vegan song titles) for disambiguation and curator visibility, with a **strict anti-circularity guardrail**: song lyrics alone can signal `THEMATIC_OR_SINGLE_SONG` or trigger a Stage 4C search, but **never** elevate an artist to `EXPLICIT_VEGAN_BAND` or `VEGAN_MEMBERS` without independent external artist/member evidence.
   - Add `scene_tags TEXT[]` (e.g., `straight_edge`) so straight-edge bands remain honestly `SEARCHED_UNVERIFIED` when veganism isn't explicitly documented while remaining discoverable to curators.
2. **Separate Catalogue Bounds From External Release Years (F3.3):**
   - Move `Catalogue Albums` values into dedicated `catalogue_earliest_year` / `catalogue_latest_year` columns and report external release-year coverage separately from catalogue-derived floors/ceilings.
3. **Country Semantics & Historical States (F6):**
   - Define `proposed_country` strictly as canonical `Intl.DisplayNames` **country of origin/formation**, add optional `secondary_countries TEXT[]` for binational bands, map historical states to present-day countries (`East Germany` → `Germany`, noting historical context in bio/notes), and rely on cross-source corroboration rather than country heuristics (noting e.g. *The Rebel Riot* is genuinely from Yangon, Myanmar).

---

## 3. Proposed Staging JSON Shapes (For Quick Sign-Off)

**Proposed Member Object (`proposed_members` JSONB array element):**
```json
{
  "canonical_key": "chris cerulli",
  "name": "Chris Cerulli",
  "aliases": ["Chris \"Motionless\" Cerulli", "Motionless"],
  "name_source": "MusicBrainz",
  "is_current": true,
  "start_year": 2005,
  "end_year": null,
  "tenure_source": "MusicBrainz",
  "ethical_stance": "VEGAN",
  "vegan": true,
  "vegan_source": "Gemini Web Search + L4C",
  "vegan_confidence": "HIGH",
  "vegan_evidence_note": "Confirmed vegan in 2021 interview.",
  "vegan_evidence_url": "https://example.org/interview"
}
```

**Field Conflict Object (`field_conflicts` JSONB keyed by field name):**
```json
{
  "first_release_year": {
    "status": "CONFLICT",
    "candidates": [
      {"value": 2014, "source": "MusicBrainz", "confidence": "MEDIUM", "detail": "MB_TITLE_VERIFIED"},
      {"value": 1995, "source": "Catalogue Albums", "confidence": "CATALOGUE", "detail": "albums.release_date min"},
      {"value": 1990, "source": "Gemini Bio Year", "confidence": "LOW", "detail": "formed 1990 in proposed_bio"}
    ],
    "resolution_note": "L4C flagged likely wrong MBID identity match; quarantined from bulk-approve."
  }
}
```

---

## 4. Four Quick Alignment Questions Before We Migrate & Re-Run

1. **Stance & Member Shape:** Do the 6-value `artist_vegan_stance` enum, per-member `ethical_stance` + per-attribute provenance JSON above, and `scene_tags TEXT[]` fit cleanly into your planned `/admin/artists` workbench?
2. **Conflict & Evidence Shapes:** Does the `field_conflicts` structure above (plus resolved `evidence_sources` objects `{final_url, redirect_url, page_title, domain, retrieved_at, http_status}`) give your bulk-approve lane (`EXACT_ID` / rule-derived `HIGH` with `0` conflicts) and per-artist card everything they need?
3. **`artist_enrichment_review` Ownership (F2.7):** There are zero references to `artist_enrichment_review` in `vegan-playlist-analysis` — it appears to have been created inside `vegan-playlist` (possibly from an earlier MusicBrainz match-review pass). Can you confirm whether you own/use it, or whether it can be archived/documented on your side?
4. **Catalogue Bounds Display:** Should `catalogue_earliest_year` and `catalogue_latest_year` be exposed in the admin proposal card as a separate *"Derived from catalogue"* reference alongside external release years, or used strictly as internal reconciliation bounds?
