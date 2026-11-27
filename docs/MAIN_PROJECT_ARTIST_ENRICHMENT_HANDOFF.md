# Artist Enrichment V2 Handoff: Main Project (`vegan-playlist`) Integration Spec

**Last verified against PostgreSQL `vegan_playlist`:** 2026-11-27  
**Compatibility contract:** Satisfies every requirement in `ARTIST_ENRICHMENT_V2_MAIN_PROJECT_REPLY.md` & `ARTIST_ENRICHMENT_V2_DRYRUN_REVIEW.md`.  
**Option A Strict Provenance Invariant:** `vegan-playlist-analysis` **never** modifies `artists`, `artist_members`, or `artist_enrichment_review`. All machine-collected proposals sit strictly in `artist_enrichment_proposals` (plus append-only lineage in `artist_enrichment_runs` and `artist_enrichment_snapshots`) until a curator reviews and accepts them.

---

## 1. Live V2 Database Coverage & Compliance Status (`2026-11-27`)

After the `$0.00` deterministic V2 backfill (`793` eligible artists, excluding `5` `^ZZZ` fixtures and `0`-song/rejected-only rows), partial Stage 4C multi-agent verification (`358` L4C-1 + `151` L4C-2), and `$0.00` free L1–L3 enrichment (`enrich_artist_free_v2.py`), all **10/10 contract compliance checks PASS** (`18/18` golden set, `0` `vertexaisearch` redirects, `0` snippet-URL mismatches, `0` off-allow-list values, `0` future/inverted years, `0` `Person` rows with members, `0` `VEGAN_MEMBERS` groups with `0` `vegan=true` members, `0` lyric-text leaks):

| Field / Metric | Published Eligible (`643`) | All Eligible (`793`) | Confidence / Breakdown |
| :--- | :---: | :---: | :--- |
| **MusicBrainz ID (`proposed_musicbrainz_id`)** | **`386` (`60.0%`)** | **`420` (`53.0%`)** | `EXACT_ID=270`, `MEDIUM=115`, `LOW=23` *(weak `MB_TITLE_VERIFIED`)*, `CONFLICT=12`, `NULL=373` (`mbid_match_evidence=149`) |
| **Wikidata QID (`proposed_wikidata_qid`)** | — | **`127`** | Exact Spotify ID (`P1902`) matches |
| **Country (`proposed_country`)** | **`612` (`95.2%`)** | **`722` (`91.0%`)** | `EXACT_ID=255`, `HIGH=53`, `MEDIUM=410`, `CONFLICT=4`, `NULL=71` (**Safe `EXACT_ID+HIGH` = `308` total / `285` pub**) |
| **External First Release Year (`proposed_first_release_year`)** | **`553` (`86.0%`)** | **`656` (`82.7%`)** | `EXACT_ID=226`, `MEDIUM=430`, `NULL=137` *(ungrounded guesses & `Catalogue Albums` removed)* |
| **External Last Release Year (`proposed_last_release_year`)** | **`542` (`84.3%`)** | **`634` (`79.9%`)** | `EXACT_ID=226`, `MEDIUM=408`, `NULL=159` *(strictly `<= CURRENT_YEAR`)* |
| **Catalogue Bounds (`catalogue_earliest/latest_year`)** | — | **`728` (`91.8%`)** | Separate Spotify/catalogue reference bounds (never auto-proposed as external dates) |
| **Artist Type (`artist_type`)** | — | **`715` (`90.2%`)** | `Person`, `Group`, or `Project` (solo `Person` rule enforced) |
| **Plain-English Bio (`proposed_bio`)** | **`642` (`99.8%`)** | **`790` (`99.6%`)** | **`691`** `bio_grounded = true` (`128` Wikipedia incl. `7` non-English articles, `203` Bandcamp, `208` websites) |
| **Vegan Notes (`proposed_vegan_notes`)** | **`517` (`80.4%`)** | **`594` (`74.9%`)** | `advocacy_confidence` across `793`: `HIGH=360`, `MEDIUM=237`, `LOW=196` |
| **Band Members (`proposed_members` JSONB)** | — | **`517` rows** | **`2,707`** member entries (**`178`** verified `vegan=true` + note + URL; **`837`** with `start_year`/`end_year` tenure) |
| **Resolved Evidence URLs (`evidence_urls`)** | — | **`735` (`92.7%`)** | `0` redirects; `100%` `evidence_snippets[].url ⊆ evidence_urls` |
| **Conflicts & Collisions** | — | **`67` / `14`** | `67` `field_conflicts` rows, `14` `identity_collisions` rows (`224` `scene_tags` rows) |

### 6-Value Advocacy Stance Distribution (`793` Eligible / `643` Published)

| `artist_vegan_stance` | Published (`643`) | All Eligible (`793`) | UI Meaning |
| :--- | :---: | :---: | :--- |
| `THEMATIC_OR_SINGLE_SONG` | **222** | **248** | General/non-vegan artist addressing animal-rights/vegan themes in song(s) only |
| `EXPLICIT_VEGAN_BAND` | **191** | **221** | Band explicitly identifies as vegan / vegan straight-edge, OR solo artist confirmed vegan |
| `SEARCHED_UNVERIFIED` | **81** | **150** | Search executed; insufficient reliable evidence (not negative proof!) |
| `VEGETARIAN_OR_ANIMAL_RIGHTS` | **88** | **106** | Confirmed vegetarian, pescatarian, "mostly vegan / cheats", or AR supporter without confirmed personal veganism |
| `VEGAN_MEMBERS` | **61** | **68** | Multi-member group with `>= 1` snippet-verified `ethical_stance='VEGAN'` (`vegan=true`) member |
| `NOT_SEARCHED` | **0** | **0** | Layer 4 search has not yet run |

> [!NOTE]
> **`358` L4C-1** entailment audits and **`151` L4C-2** Search-ON conflict/gap resolutions are already committed. The remaining **`91` L4C-2** (`44` pub / `47` unpub) + **`10` L4C-1** rows are queued for next week after AI Studio credit top-up (`docs/PENDING_API_RUNS.md`). Because all V2 schema columns and allow-list guarantees are already live and `10/10` compliant, the `/admin/artists` V2 integration can proceed immediately.

Top staged published countries (`612` populated): `United States (216)`, `United Kingdom (132)`, `Germany (32)`, `Australia (28)`, `Sweden (27)`, `Canada (25)`, `Spain (15)`, `Italy (15)`, `France (13)`, `Netherlands (13)`, `New Zealand (8)`, `Chile (8)`.

---

## 2. Exact V2 PostgreSQL Schema (Additive Only)

### A. `artist_enrichment_proposals` (Latest Materialized Staging View)

```sql
CREATE TABLE IF NOT EXISTS artist_enrichment_proposals (
    artist_id                    INTEGER PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
    proposed_musicbrainz_id      UUID,
    mbid_match_method            VARCHAR(32),   -- 'EXISTING' | 'WIKIDATA_P1902' | 'MB_SPOTIFY_URL' | 'MB_TITLE_VERIFIED'
    mbid_confidence              VARCHAR(16),   -- 'EXACT_ID' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CONFLICT'
    mbid_match_evidence          JSONB,         -- V2: title-match audit & RG IDs
    proposed_wikidata_qid        VARCHAR(32),
    proposed_bandcamp_url        VARCHAR(500),
    proposed_website_url         VARCHAR(500),  -- Non-social official artist URLs only
    wikipedia_url                VARCHAR(500),
    artist_type                  VARCHAR(32),   -- 'Person' | 'Group' | 'Project'
    artist_type_source           VARCHAR(32),   -- V2: 'MusicBrainz/Wikidata' | 'Bandcamp' | 'Official Website' | 'Gemini Web Search' | 'deterministic_v2' | 'INFERRED_*'
    artist_type_confidence       VARCHAR(16),   -- V2: 'EXACT_ID' | 'MEDIUM' | 'LOW'
    proposed_aliases             TEXT[],        -- V2: Person real/stage names & alternate credits
    secondary_countries          TEXT[],        -- V2: optional binational countries

    proposed_country             TEXT,          -- Canonical English country of origin/formation
    country_source               VARCHAR(64),   -- Strict allow-list only (see Section 3)
    country_confidence           VARCHAR(16),   -- 'EXACT_ID' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CONFLICT'
    proposed_first_release_year  INTEGER,       -- External earliest studio release (<= CURRENT_YEAR)
    first_release_source         VARCHAR(64),   -- Strict allow-list only
    first_release_confidence     VARCHAR(16),
    proposed_formed_year         INTEGER,       -- Deprecated (kept nullable for reader compat)
    formed_source                VARCHAR(64),
    formed_confidence            VARCHAR(16),
    proposed_disbanded_year      INTEGER,       -- Deprecated (kept nullable for reader compat)
    disbanded_source             VARCHAR(64),
    disbanded_confidence         VARCHAR(16),
    proposed_last_release_year   INTEGER,       -- External latest studio release (<= CURRENT_YEAR)
    last_release_source          VARCHAR(64),   -- Strict allow-list only
    last_release_confidence      VARCHAR(16),
    catalogue_earliest_year      INTEGER,       -- V2: Spotify catalogue min album year (reference only)
    catalogue_latest_year        INTEGER,       -- V2: Spotify catalogue max album year (reference only)
    catalogue_lyric_signal       JSONB,         -- V2: lyric codes + song_titles only (ZERO lyric text!)
    proposed_members             JSONB,         -- V2: canonicalized member objects (empty for Person)

    proposed_bio                 TEXT,
    bio_source                   VARCHAR(64),
    bio_sources                  TEXT[],        -- V2: e.g. ['Wikipedia', 'Bandcamp', 'Official Website', 'gemini-4-hydrogen+Search']
    bio_grounded                 BOOLEAN,       -- V2: true if backed by resolved URL / Wikipedia / Bandcamp / website
    proposed_vegan_notes         TEXT,
    artist_vegan_stance          VARCHAR(32),   -- 6-value enum (Section 1)
    propose_no_advocacy_notes    BOOLEAN,
    advocacy_confidence          VARCHAR(16),   -- 'EXACT_ID' | 'HIGH' | 'MEDIUM' | 'LOW' | 'CONFLICT'
    scene_tags                   TEXT[],        -- V2: ['straight_edge', 'anarcho_punk', 'hardline']
    evidence_urls                TEXT[],        -- Resolved direct URLs (0 vertexaisearch redirects)
    evidence_snippets            JSONB,         -- [{claim, snippet, url}] where url in evidence_urls
    evidence_sources             JSONB,         -- V2: [{final_url, redirect_url, domain, http_status, retrieved_at, quote, supports}]

    field_conflicts              JSONB,         -- V2: external conflicts, catalogue_disagrees, l4c2_resolution
    identity_collisions          JSONB,         -- V2: mbid/qid/bandcamp/name cross-artist collisions
    validation_notes             JSONB,         -- V2: deterministic Stage 4B audit actions
    search_status                VARCHAR(32),   -- 'SEARCHED_WITH_RESULTS' | 'SEARCHED_NO_RESULTS' | 'MEMORY_ONLY' | 'UNKNOWN_LEGACY'
    grounding_queries            TEXT[],
    grounding_chunk_count        INTEGER,
    grounding_supports_count     INTEGER,
    stage4c_model                VARCHAR(64),
    stage4c_verdict              JSONB,         -- V2: L4C-1 entailment verdict & optional l4c2_stance_override
    stage4c_reviewed_at          TIMESTAMP,
    source_artist_updated_at     TIMESTAMP,     -- V2: snapshot of artists.updated_at for staleness detection
    last_run_id                  UUID,          -- V2: FK-compatible lineage ID in artist_enrichment_runs
    pipeline_version             VARCHAR(32),   -- V2: e.g. 'v2.0-stage4b', 'v2.0-stage4c', 'v2.0-free-enrichment', 'v2.0-layer4a'

    bandcamp_location_raw        TEXT,
    bandcamp_bio_raw             TEXT,
    wikipedia_extract            TEXT,
    layers_completed             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    layer4_model                 VARCHAR(64),
    layer4_prompt_tokens         INTEGER,
    layer4_output_tokens         INTEGER,
    layer4_thought_tokens        INTEGER,
    layer4_search_queries        INTEGER,
    review_status                VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    reviewed_at                  TIMESTAMP,
    updated_at                   TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### B. Lineage & Audit Snapshot Tables (Append-Only)

```sql
CREATE TABLE IF NOT EXISTS artist_enrichment_runs (
    run_id            UUID PRIMARY KEY,
    pipeline_version  VARCHAR(32) NOT NULL,
    stage             VARCHAR(32) NOT NULL,
    model             VARCHAR(64),
    prompt_hash       VARCHAR(64),
    params_json       JSONB,
    summary_json      JSONB,
    started_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    finished_at       TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artist_enrichment_snapshots (
    id                        BIGSERIAL PRIMARY KEY,
    run_id                    UUID NOT NULL REFERENCES artist_enrichment_runs(run_id) ON DELETE CASCADE,
    artist_id                 INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    stage                     VARCHAR(32) NOT NULL,
    model                     VARCHAR(64),
    raw_response_json         JSONB,
    grounding_metadata_json   JSONB,
    created_at                TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## 3. Strict Vocabularies & Live Reader Contract (`artistEnrichment.js` / `artistFacts.js`)

1. **`*_source` Allow-List** (`country_source`, `first_release_source`, `last_release_source`, `proposed_members[].source`, `vegan_source`):
   - Strictly one of: `'MusicBrainz'`, `'Wikidata'`, `'Bandcamp'`, `'Catalogue Albums'`, `'Gemini Web Search'`, `'Added by curator'`.
   - Web-only provenance labels like `'Official Website'` or `'Wikipedia'` are stored in `bio_sources` / `artist_type_source` only, never in the `*_source` columns above.
2. **`*_confidence` Allow-List**:
   - Strictly one of: `'EXACT_ID'`, `'HIGH'`, `'MEDIUM'`, `'LOW'`, `'CONFLICT'`.
   - Bulk-approve / pre-trust MUST exclude both `'CONFLICT'` and `'LOW'`, and inspect `field_conflicts` before accepting.
3. **`artist_enrichment_review` Ownership**:
   - Strictly web-owned by `vegan-playlist`. `vegan-playlist-analysis` never reads, writes, or references it.
4. **Staleness Check**:
   - Flag a proposal as **Stale (Needs Refresh)** in UI when `artists.updated_at IS NOT NULL AND source_artist_updated_at IS NOT NULL AND artists.updated_at > source_artist_updated_at`.
5. **Solo `Person` Rule & `VEGAN_MEMBERS` Invariant**:
   - Solo (`Person`) artists always carry `proposed_members = NULL` (legal/stage aliases live in `proposed_aliases`), and solo vegans use `EXPLICIT_VEGAN_BAND` (never `VEGAN_MEMBERS`). Every `VEGAN_MEMBERS` row guarantees `>= 1` `vegan: true` (`ethical_stance: "VEGAN"`) member backed by `evidence_note` and resolved `vegan_evidence_url`.
6. **Zero Copyright Leaks**:
   - `catalogue_lyric_signal` stores only abstract codebook keys (`advocacy`, `themes`, `topics`) and `song_titles` (`0` lyric or audio transcript strings).

---

## 4. Verified V2 JSONB Payload Examples (Live Shapes)

### A. `proposed_members[]` (from ID `3544` Gojira)
Each object guarantees backwards-compatible `name`, `is_current`, `source`, `vegan` plus additive V2 keys:
```json
[
  {
    "name": "Christian Andreu",
    "canonical_key": "christian andreu",
    "aliases": [],
    "is_current": true,
    "source": "MusicBrainz",
    "name_source": "MusicBrainz",
    "start_year": 1996,
    "end_year": null,
    "tenure_source": "MusicBrainz",
    "ethical_stance": "UNKNOWN",
    "vegan": false,
    "vegan_source": null,
    "vegan_confidence": null,
    "vegan_evidence_note": null,
    "vegan_evidence_url": null,
    "evidence_note": null
  },
  {
    "name": "Joe Duplantier",
    "canonical_key": "joe duplantier",
    "aliases": [],
    "is_current": true,
    "source": "MusicBrainz",
    "name_source": "MusicBrainz",
    "start_year": 1996,
    "end_year": null,
    "tenure_source": "MusicBrainz",
    "ethical_stance": "VEGAN",
    "vegan": true,
    "vegan_source": "Gemini Web Search",
    "vegan_confidence": "HIGH",
    "vegan_evidence_note": "Vegan since 2014; animal-rights advocate and featured in a 2024 PETA vegan campaign.",
    "vegan_evidence_url": "https://en.wikipedia.org/wiki/Joe_Duplantier",
    "evidence_note": "Vegan since 2014; animal-rights advocate and featured in a 2024 PETA vegan campaign."
  }
]
```

### B. `field_conflicts` (from ID `1664` ManLiftingBanner)
```json
{
  "first_release_year": {
    "status": "CATALOGUE_DISAGREES",
    "all_statuses": ["INTERNAL_INCONSISTENCY", "CATALOGUE_DISAGREES"],
    "candidates": [
      {"value": 2014, "source": "MusicBrainz"},
      {"value": 1995, "source": "Catalogue Albums"},
      {"value": 1990, "source": "Gemini Bio Year"}
    ]
  },
  "l4c2_resolution": {
    "status": "EXTERNAL_INCOMPLETE_CORRECTED",
    "rationale": "MusicBrainz only tracked ManLiftingBanner's 2014 comeback LP 'Red Fury'... Primary discographies confirm their debut release was the 1991 7-inch EP 'Myth of Freedom' and their latest full-length was 'Red Fury' in 2014."
  }
}
```

### C. `evidence_sources` (from ID `81` Earth Crisis)
```json
[
  {
    "final_url": "https://en.wikipedia.org/wiki/Earth_Crisis",
    "redirect_url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/...",
    "domain": "en.wikipedia.org",
    "http_status": 302,
    "retrieved_at": "2026-11-27T06:56:06.832268+00:00",
    "supports": "advocacy",
    "quote": "The band is known for supporting animal rights, promoting a straight edge and vegan lifestyle, and addressing further social and political issues."
  }
]
```

### D. `mbid_match_evidence`, `identity_collisions`, `catalogue_lyric_signal`, `stage4c_verdict`
- **`mbid_match_evidence`** (ID `1664`):
```json
{
  "matched_titles": ["we will not rest"],
  "match_count": 1,
  "non_generic_count": 1,
  "strong_match": false,
  "mb_rg_ids": ["00fdad17-b38f-38cc-8f21-82fb85eb4ca3"],
  "mb_first_year": 2014,
  "mb_last_year": 2014,
  "year_delta": 19
}
```
- **`identity_collisions`** (ID `64` / `162`):
```json
{"name_shared_with": [13509]}
```
- **`catalogue_lyric_signal`** (ID `81`, codes + titles only):
```json
{
  "coded_songs": 162,
  "advocacy": ["abolition", "advocacy", "boycott", "direct_confrontation", "underground_rescue", "vegan_practice"],
  "themes": ["animal_suffering"],
  "topics": ["animals", "animals_death_and_pain", "apathy"],
  "song_titles": ["All Out War", "Biomachines", "Born From Pain", "By Conscience Compelled"]
}
```
- **`stage4c_verdict`** (ID `3544` Gojira):
```json
{
  "recommended_stance": "VEGAN_MEMBERS",
  "recommended_confidence": "HIGH",
  "promotes_vs_is": "IS_VEGAN",
  "band_vs_member": "SPECIFIC_MEMBERS_ONLY",
  "subject_attachment": "DIRECT_QUOTE",
  "time_scope": "CURRENT_OR_ONGOING",
  "flagged_nuances": [],
  "rationale": "Direct quotes from Joe Duplantier explicitly confirm he transitioned to a vegan lifestyle in 2014 for animal rights and health.",
  "verified_vegan_members": [
    {
      "name": "Joe Duplantier",
      "ethical_stance": "VEGAN",
      "evidence_quote": "I became vegan for the animals. But another benefit to being vegan is for your health..."
    }
  ]
}
```

---

## 5. Recommended Two-Speed Admin UI (`/admin/artists`)

### A. 1-Click Safe Bulk-Approve Lane
- Preview & apply **only** when destination columns on `artists` are currently **NULL** (never overwriting curator data) and ONLY for `confidence IN ('EXACT_ID', 'HIGH')` with **no** unresolved entry in `field_conflicts` (excluding `LOW`, `CONFLICT`, and catalogue-only bounds):
  - Right now: **`285` published artist countries** (`EXACT_ID` / 2-source `HIGH`), **`~226` external first/last release years** (`EXACT_ID` with 0 conflicts), and **`270` `EXACT_ID` MusicBrainz IDs** (`bandCheck.saveIdentity` single-writer guard).

### B. Per-Artist V2 Proposal Card (`/admin/artist/:id`)
- Show a **Pipeline provenance & staleness badge** (`pipeline_version`, `last_run_id`, warning if `artists.updated_at > source_artist_updated_at`).
- Display **`proposed_bio`** (`bio_sources` chips, `bio_grounded` warning if `false`), **`proposed_country`** + conflict drawer if `field_conflicts.country` exists, and **`proposed_first/last_release_year`** alongside read-only **"From the catalogue"** (`catalogue_earliest_year`–`catalogue_latest_year`).
- Display **6-value `artist_vegan_stance` pill**, `scene_tags`, `advocacy_confidence`, `proposed_vegan_notes`, clickable **resolved `evidence_sources`** cards (`final_url`, `domain`, `quote`, `supports`), and **Stage 4C entailment rationale** (`stage4c_verdict`).
- Display **`proposed_members[]`** checklist with `start_year`–`end_year` tenure, `ethical_stance` badge, and pre-selected `vegan: true` suggestion backed by `vegan_evidence_note` + `vegan_evidence_url` (**curator click writes `artist_members.vegan`**).
- Surface **`identity_collisions`** and **`mbid_match_evidence`** (especially when `mbid_confidence = 'LOW'` or `strong_match = false`) inside the MBID match review card.
