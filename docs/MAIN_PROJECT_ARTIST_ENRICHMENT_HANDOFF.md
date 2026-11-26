# Artist Enrichment Pipeline Handoff: Main Project (`vegan-playlist`) Integration Spec

This specification documents the **Option A Artist Data Collection Pipeline** built for Part 2 of the catalogue upgrade, detailing the live **`artist_enrichment_proposals`** staging table in shared PostgreSQL `vegan_playlist`, the verified Layers 1–3 (`$0.00`) coverage now ready for curator bulk-approval, and the planned Layer 4 web-grounded research cards.

> **Option A Strict Provenance Invariant**:
> Nothing in `vegan-playlist-analysis` ever writes to `artists` or `artist_members`. Curator-owned **`artists`** (`bio = 0`, `vegan_advocacy_notes = 0`) and **`artist_members`** (`10` curator rows) remain completely separate. All machine-collected proposals sit in **`artist_enrichment_proposals`** until a curator accepts them.

---

## 1. Live Database Coverage Ready Right Now (`2026-11-27`)

Layers 1–3 (`$0.00` deterministic + public archive harvesting via Wikidata `P1902`, MusicBrainz URL/title-verified lookup, Bandcamp scraping/search, and DB album release floors) and **Layer 4 (`gemini-4-hydrogen` + Google Search grounding across `100%` of all `803 / 803` eligible artists, incl. all `644 / 644` published artists)** are **complete**. Career lifespan uses **`proposed_first_release_year`** – **`proposed_last_release_year`**:

| Field / Metric | Published Artists (`644`) | All Staged Artists (`803`) | Sources & Breakdown |
| :--- | :---: | :---: | :--- |
| **MusicBrainz ID (`proposed_musicbrainz_id`)** | **`387` (`60.1%`)** | **`422`** | `MB_SPOTIFY_URL`, `WIKIDATA_P1902`, `MB_TITLE_VERIFIED`, `EXISTING` |
| **Country (`proposed_country`)** | **`618` (`96.0%`)** | **`766` (`95.4%`)** | `MusicBrainz`, `Wikidata`, `Bandcamp`, + `Gemini Web Search` |
| **First Release Year (`proposed_first_release_year`)** | **`644` (`100.0%`)** | **`798` (`99.4%`)** | `MusicBrainz`, `Catalogue Albums`, + `Gemini Web Search` |
| **Last Release Year (`proposed_last_release_year`)** | **`644` (`100.0%`)** | **`798` (`99.4%`)** | `MusicBrainz`, `Bandcamp`, `Catalogue Albums`, + `Gemini Web Search` |
| **Plain-English Bio (`proposed_bio`)** | **`642` (`99.7%`)** | **`793` (`98.8%`)** | `gemini-4-hydrogen+Search` (`788`) + `gemini-3.8-flash+Search` (`15`) |
| **Vegan Notes (`proposed_vegan_notes`)** | **`470` (`73.0%`)** | **`551` (`68.6%`)** | Grounded & cited only (`403 HIGH`, `156 MEDIUM`, `244 LOW`) |
| **Band Members (`proposed_members` JSONB)** | — | **`611`** | MusicBrainz + Wikidata + Layer 4 search (**`367`** members tagged `vegan = true`) |
| **Grounded Evidence URLs (`evidence_urls`)** | — | **`689`** | Google Search grounding redirects + Wikipedia + Bandcamp |
| **Layer 4 Stance Mix (`803 / 803` = `100%`)** | **`644 / 644` (`100%`)** | **`803 / 803` (`100%`)** | `EXPLICIT_VEGAN_BAND=290` (`244` pub), `UNVERIFIED=202` (`128` pub), `THEMATIC_OR_SINGLE_SONG=193` (`170` pub), `VEGAN_MEMBERS=118` (`102` pub) |

Top staged countries across published artists (`358` populated — already **14× above** the `25`-artist auto-activation threshold for the redesigned **Explore → Data** World Map!):
`United States (142)`, `United Kingdom (86)`, `Canada (17)`, `Germany (15)`, `Australia (14)`, `Sweden (13)`, `Spain (8)`, `Netherlands (8)`, `Italy (8)`, `France (5)`, `Jamaica (4)`, `New Zealand (3)`.

---

## 2. Exact Staging Schema (`artist_enrichment_proposals`)

```sql
CREATE TABLE IF NOT EXISTS artist_enrichment_proposals (
    artist_id                    INTEGER PRIMARY KEY REFERENCES artists(id) ON DELETE CASCADE,
    proposed_musicbrainz_id      UUID,
    mbid_match_method            VARCHAR(32),   -- 'EXISTING' | 'WIKIDATA_P1902' | 'MB_SPOTIFY_URL' | 'MB_TITLE_VERIFIED'
    mbid_confidence              VARCHAR(16),   -- 'EXACT_ID' | 'HIGH'
    proposed_wikidata_qid        VARCHAR(32),
    proposed_bandcamp_url        VARCHAR(500),
    proposed_website_url         VARCHAR(500),
    wikipedia_url                VARCHAR(500),
    artist_type                  VARCHAR(32),   -- 'Person' | 'Group' | ...

    proposed_country             TEXT,          -- Canonical English name matching Intl.DisplayNames (e.g. 'United States')
    country_source               VARCHAR(64),   -- 'MusicBrainz' | 'Wikidata' | 'Bandcamp' | 'Gemini Web Search'
    country_confidence           VARCHAR(16),   -- 'EXACT_ID' | 'HIGH' | 'MEDIUM'
    proposed_first_release_year  INTEGER,       -- Earliest studio song/EP/album release year (bands & solo artists)
    first_release_source         VARCHAR(64),   -- 'MusicBrainz' | 'Bandcamp' | 'Catalogue Albums' | 'Gemini Web Search'
    first_release_confidence     VARCHAR(16),
    proposed_formed_year         INTEGER,       -- Deprecated (kept nullable for backwards compatibility)
    formed_source                VARCHAR(64),
    formed_confidence            VARCHAR(16),
    proposed_disbanded_year      INTEGER,       -- Deprecated (kept nullable for backwards compatibility)
    disbanded_source             VARCHAR(64),
    disbanded_confidence         VARCHAR(16),
    proposed_last_release_year   INTEGER,       -- Most recent studio song/EP/album release year
    last_release_source          VARCHAR(64),   -- 'MusicBrainz' | 'Bandcamp' | 'Catalogue Albums' | 'Gemini Web Search'
    last_release_confidence      VARCHAR(16),
    proposed_members             JSONB,         -- [{name, is_current, vegan?, source, evidence_note?}]

    proposed_bio                 TEXT,          -- Layer 4: 2-3 neutral factual sentences
    bio_source                   VARCHAR(64),
    proposed_vegan_notes         TEXT,          -- Layer 4: concise documented stance/advocacy notes (null if unverified)
    artist_vegan_stance          VARCHAR(32),   -- 'EXPLICIT_VEGAN_BAND' | 'VEGAN_MEMBERS' | 'THEMATIC_OR_SINGLE_SONG' | 'UNVERIFIED'
    propose_no_advocacy_notes    BOOLEAN,
    advocacy_confidence          VARCHAR(16),   -- 'HIGH' | 'MEDIUM' | 'LOW'
    evidence_urls                TEXT[],        -- Grounded / source URLs (image assets filtered)
    evidence_snippets            JSONB,         -- [{claim, snippet, url}]

    bandcamp_location_raw        TEXT,
    bandcamp_bio_raw             TEXT,
    wikipedia_extract            TEXT,
    layers_completed             TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    layer4_model                 VARCHAR(64),
    layer4_prompt_tokens         INTEGER,
    layer4_output_tokens         INTEGER,
    layer4_thought_tokens        INTEGER,
    layer4_search_queries        INTEGER,
    review_status                VARCHAR(24) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'APPROVED' | 'PARTIAL' | 'REJECTED'
    reviewed_at                  TIMESTAMP,
    updated_at                   TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## 3. Required Adjustments in `vegan-playlist` Backend Services

1. **Keep `publicFacts` Strictly Curator-Accepted (`backend/services/artistFacts.js`)**:
   - Continue serving `publicFacts` ONLY from `artists` and `artist_members`. Never expose `artist_enrichment_proposals` on any public `/api/spotify/*` or `/api/analytics/*` route.
2. **Allow New Provenance Sources in `artistFacts.js`**:
   - Currently `SOURCES` in `backend/services/artistFacts.js` only allows `'MusicBrainz'` and `'Added by curator'`.
   - When accepting staged proposals from `artist_enrichment_proposals`:
     - Either expand `SOURCES` in `artistFacts.js` to accept `'Wikidata'`, `'Bandcamp'`, `'Catalogue Albums'`, `'Gemini Web Search'` (recommended, keeping provenance visible in admin), **OR** normalize MusicBrainz/Wikidata/Bandcamp proposals cleanly to `'MusicBrainz'` / `'Added by curator'` on save.
3. **Identity Single-Writer Guard (`CLAUDE.md`)**:
   - `bandCheck.saveIdentity` currently owns `artists.musicbrainz_id` and `artists.bandcamp_url`. Reuse/invoke that same validation guard when approving `proposed_musicbrainz_id` / `proposed_bandcamp_url` so no artist identity constraint or URL validation is bypassed.

---

## 4. Recommended Two-Speed Admin Review UI (`/admin/artists`)

### A. 1-Click Bulk Approve Lane (Deterministic & High-Confidence Facts)
Right now, **`~387` MusicBrainz IDs**, **`618` artist countries**, **`644` first release years**, and **`644` last release years** across published artists are ready in `artist_enrichment_proposals`:
- Add a clean **"Proposed facts" / Bulk Approve** action in the Admin Artists area that previews & applies ONLY where the destination column on `artists` is currently **NULL** (never overwriting existing curator entries!):
  - Filter preset: `confidence IN ('EXACT_ID', 'HIGH')` (optionally split into `EXACT_ID` only vs `EXACT_ID + HIGH` vs including `Gemini Web Search` `MEDIUM`), plus optional `Catalogue Albums` release-year floors (`first_release_source` / `last_release_source` preserved).
  - Applies transactionally (`proposed_country` -> `artists.country` + `country_source`, `proposed_first_release_year` -> `artists.first_release_year` + `first_release_source`, `proposed_last_release_year` -> `artists.last_release_year` + `last_release_source`, `proposed_musicbrainz_id` / `proposed_bandcamp_url` when empty, and optionally MusicBrainz/Wikidata `proposed_members` into `artist_members` with `vegan = false`).
  - **Immediate payoff**: One curator approval pass populates up to `618` published artist countries and `644/644` release spans (`first_release_year`–`last_release_year`), immediately lighting up the **Explore → Data** World Map and release-era timeline.

### B. Per-Artist AI Proposal Card in `ArtistWorkbench` (`/admin/artist/:id`)
`L4_GEMINI` proposals are now live across **all `803 / 803` (`100%`) eligible artists** (including all `644 / 644` published artists):
- Show a collapsible **"Proposed enrichment"** panel alongside `ArtistFactsPanel` & Bio/Notes:
  - **`proposed_bio`**: Diff/preview with **Use bio** (copies into `artists.bio` for editing/saving).
  - **Vegan Stance & Advocacy**: Color-coded stance pill (`EXPLICIT_VEGAN_BAND`, `VEGAN_MEMBERS`, `THEMATIC_OR_SINGLE_SONG`, `UNVERIFIED`), confidence badge, `proposed_vegan_notes` textarea preview, and clickable `evidence_urls` + quoted `evidence_snippets`.
    - Actions: **Use advocacy notes** (fills `artists.vegan_advocacy_notes`), **Mark no advocacy notes needed** (for confirmed `THEMATIC_OR_SINGLE_SONG` bands where `propose_no_advocacy_notes = true`), or **Dismiss proposal** (`review_status = 'REJECTED'`).
  - **Proposed Members**: Checklist showing `name`, `is_current`, proposed `vegan` badge + `evidence_note` so the curator can selectively approve verified `artist_members` entries (`vegan = true` strictly opt-in upon curator review).
