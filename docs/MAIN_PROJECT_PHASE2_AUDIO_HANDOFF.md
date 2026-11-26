# Phase 2 Audio Handoff: Main Project (`vegan-playlist`) Integration Spec

This specification aligns `vegan-playlist` with the **V2.1 Decoupled Audio Analysis Pipeline**, **574D Hybrid-C Audio Similarity**, and **Upgraded 2D/3D UMAP Projections** now live in shared PostgreSQL `vegan_playlist`.

> **CRITICAL — DO NOT READ DEPRECATED LEGACY AUDIO COLUMNS OR OLD 6D VECTORS**
> 1. **Stop reading legacy audio columns from `song_lyric_analysis`**: `sonic_energy`, `emotional_mood`, `rhythmic_style`, `acoustic_type`, `vocal_delivery`, and `tempo_bpm` on `song_lyric_analysis` are frozen legacy Librosa/early-pipeline approximations. All production sound data now lives in **`song_audio_analysis`** (`model_used = 'gemini-4-hydrogen'`, `audio_status = 'OK'`).
> 2. **Stop reading 6D / 1024D rows in `song_embeddings.audio_embedding`**: `49` un-migrated songs still retain legacy 6D `audio_embedding` vectors (`audio_embedding_model IS NULL`). For **Similar Sound**, read **`song_embeddings.audio_hybrid_embedding`** (populated ONLY for V2.1 audio-coded tracks with `audio_hybrid_model = 'clap512c_v2.1codes0.7_mir0.35'`, `dims = 574`). For raw neural audio embeddings, filter explicitly on `audio_embedding_model = 'laion/larger_clap_music_and_speech'`.

---

## 1. Live Database State Ready Right Now in `vegan_playlist`

All migrations, Firefox-authenticated YouTube backfill, 574D Hybrid-C vectors, and clean UMAP projections are already committed in shared PostgreSQL:

1. **`song_audio_analysis`** (decoupled table covering YouTube-linked songs regardless of whether lyrics exist):
   - **`1,267` `OK` rows** (`96.9%` of all `1,307` published YT songs; `model_used = 'gemini-4-hydrogen'`, `0` off-codebook violations; **`385`** songs with embedded audio samples, `591` `sample_details`, `345` transcripts; `449/1,267` [`35.4%`] reviewed by `gemini-3.8-flash`; **`1,267/1,267`** populated with **80-bin `audio_timeline` JSONB**).
   - Non-`OK` statuses tracked cleanly for pipeline bookkeeping: `31` `UNAVAILABLE` (`28` deleted/unavailable videos, `3` age-gated tracks needing account verification), `8` `TOO_LONG` (`>= 900s`), `1` `ERROR` (`39,980`-byte undersized MP3).
   - **`0`** untouched published YouTube songs remaining (`20` unpublished `included` YT songs intentionally left untouched).
2. **`song_embeddings`** (provenance + hybrid audio similarity):
   - **`1,267`** raw 512D L2-normalized multi-window CLAP vectors in `audio_embedding` (`audio_embedding_model = 'laion/larger_clap_music_and_speech'`).
   - **`1,267`** upgraded **574D Hybrid-C** vectors in **`audio_hybrid_embedding`** (`audio_hybrid_model = 'clap512c_v2.1codes0.7_mir0.35'`), combining mean-centered 512D CLAP (`weight 1.0`) + 58D V2.1 8-dimension codebook (`weight 0.7`) + 4D standardized MIR physics (`log2(tempo_bpm)`, `loudness_lufs`, `dynamic_range_lra`, `crest_factor_db`, `weight 0.35`). Songs without V2.1 audio have `audio_hybrid_embedding = NULL`.
3. **`song_coordinates`** (`1,315` clean rows; `0` stale 6D coordinates):
   - **`audio_2d` / `audio_3d`**: **`1,267`** published songs projected from **574D Hybrid-C cosine UMAP** (`n_neighbors=20, min_dist=0.12`). Songs without V2.1 audio explicitly have `NULL` (stale 6D coordinates wiped).
   - **`thematic_2d` / `thematic_3d`**: **`649`** songs (`635` published included) projected from **Lyric-Hybrid cosine UMAP** (`1.0 × Qualitative` + `0.65 × Centered 768D Semantic`).
   - **`semantic_2d` / `semantic_3d`**: **`649`** songs projected from **mean-centered 768D cosine UMAP**.
   - **`holistic_2d` / `holistic_3d`**: **`605`** songs projected from balanced **50/50 Lyric-Hybrid + 574D Audio-Hybrid-C cosine UMAP**.
4. **Option B Genre Rule Preserved**:
   - `songs.genre IS NOT NULL` remains untouched at **`562`**.
   - Audio-inferred genres live exclusively in `song_audio_analysis` (`inferred_parent_genre`, `inferred_subgenre`, `inferred_secondary_genre`, `genre_confidence`, `genre_rationale`) using canonical values from `backend/data/genre_hierarchy.json`.
   - Ready for Admin Workbench Option B review right now: **`269`** missing-genre fills (`genre-from-audio`) and **`412`** cross-parent disagreements (`genre-conflicts`).

---

## 2. Exact Schemas (`song_audio_analysis` & `song_embeddings` additions)

```sql
CREATE TABLE IF NOT EXISTS song_audio_analysis (
    song_id                   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    model_used                VARCHAR(64) NOT NULL,
    pipeline_version          VARCHAR(32) NOT NULL DEFAULT 'v2.1',
    audio_status              VARCHAR(24) NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'OK' | 'UNAVAILABLE' | 'TOO_LONG' | 'ERROR'
    youtube_id_used           VARCHAR(32),
    duration_sec              REAL,

    -- Objective Local MIR (beat_this + pyloudnorm + chroma_cqt 24-key Temperley)
    tempo_bpm                 INTEGER,
    tempo_iqr_bpm             REAL,
    tempo_stability           VARCHAR(16),           -- 'STEADY' | 'SHIFTING' | 'UNMETERED'
    loudness_lufs             REAL,
    dynamic_range_lra         REAL,
    crest_factor_db           REAL,
    musical_key               VARCHAR(16),           -- e.g. 'E minor'
    musical_mode              VARCHAR(16),           -- 'major' | 'minor'
    key_confidence            REAL,
    mir_computed_at           TIMESTAMP,
    audio_timeline            JSONB,                 -- 80-bin silence-gated {version, bins, duration_sec, bin_sec, loudness[], grit[], pulse[]}

    -- 8-Dimension Qualitative Audio Codebook V2.1
    musical_mood              TEXT[],                -- multi-select (1..2)
    sonic_intensity           VARCHAR(64),           -- single-select
    production_texture        VARCHAR(64),           -- single-select
    vocal_style               TEXT[],                -- multi-select (1..2)
    rhythmic_feel             VARCHAR(64),           -- single-select
    instrumentation           TEXT[],                -- multi-select (0..4; [] when unaccompanied)
    audio_samples             TEXT[],                -- multi-select (0..2; ['NONE'] when absent)
    dynamic_arc               VARCHAR(64),           -- single-select

    -- Rich listener & researcher details
    sonic_summary             TEXT,
    sonic_evidence            JSONB,                 -- ["0:00-0:53 ...", ...]
    sample_details            JSONB,                 -- [{type, timestamp, transcript_excerpt, speaker_or_source, identification_confidence, description}]

    -- Audio-inferred genre (Option B: separate from songs.genre)
    inferred_parent_genre     VARCHAR(64),
    inferred_subgenre         VARCHAR(100),
    inferred_secondary_genre  VARCHAR(100),
    genre_confidence          VARCHAR(16),           -- 'HIGH' | 'MEDIUM' | 'LOW'
    genre_rationale           TEXT,

    -- Reviewer telemetry
    reviewer_model            VARCHAR(64),
    review_triggered_reasons  TEXT[],
    review_notes              TEXT,
    reviewed_at               TIMESTAMP,

    prompt_tokens             INTEGER,
    output_tokens             INTEGER,
    thought_tokens            INTEGER,
    error_message             TEXT,
    analyzed_at               TIMESTAMP,
    PRIMARY KEY (song_id, model_used)
);

-- Added columns on song_embeddings:
--   audio_embedding_model   VARCHAR(64) -- 'laion/larger_clap_music_and_speech'
--   audio_hybrid_embedding  float8[]    -- 574D Hybrid-C vector
--   audio_hybrid_model      VARCHAR(64) -- 'clap512c_v2.1codes0.7_mir0.35'
```

Latest-row audio helper (mirroring `analysis.LATEST_ANALYSIS` in `backend/services/analysis.js`):
```sql
(SELECT DISTINCT ON (song_id) *
   FROM song_audio_analysis
  WHERE audio_status = 'OK'
  ORDER BY song_id, analyzed_at DESC NULLS LAST, model_used)
```

---

## 3. Sync `backend/data/acoustic_codebook.json` & Update `acousticCodebook.js` + `browseFilters.js`

1. **Copy `vegan-playlist-analysis/data/acoustic_codebook.json` → `backend/data/acoustic_codebook.json`**.
   - Contains 8 dimensions under `dimensions`:
     - **Single-select (`= ANY($n::text[])`)**:
       - `sonic_intensity` (**Intensity**, 5 codes: `Quiet`, `Moderate`, `Energetic`, `Heavy`, `Extreme`)
       - `production_texture` (**Sound**, 7 codes: `Acoustic`, `Live Band`, `Raw DIY`, `Distorted`, `Polished`, `Electronic`, `Experimental`)
       - `rhythmic_feel` (**Rhythm**, 8 codes: `Blast Beats`, `Punk Drive`, `Breakdowns`, `Steady Rock`, `Groove`, `Acoustic Strum`, `Electronic Beat`, `Beatless`)
       - `dynamic_arc` (**Dynamics**, 7 codes: `Relentless`, `Steady`, `Verse–Chorus Shifts`, `Quiet Intro, Loud Drop`, `Slow Build`, `Tempo Shifts`, `Stripped-Back`)
     - **Multi-select (`TEXT[]` array overlap `&& $n::text[]`)**:
       - `musical_mood` (**Mood**, 9 codes: `Aggressive`, `Dark`, `Mournful`, `Urgent`, `Empowering`, `Playful`, `Upbeat`, `Calm`, `Hypnotic`)
       - `vocal_style` (**Vocals**, 7 codes: `Melodic`, `Shouted`, `Screamed / Growled`, `Group Chants`, `Rap / Flow`, `Spoken Word`, `Instrumental`)
       - `instrumentation` (**Instruments**, 10 codes, `0..4`; `[]` for unaccompanied voice: `Distorted Guitar`, `Clean Guitar`, `Acoustic Guitar`, `Live Drums`, `Drum Machine`, `Synths`, `Piano / Keys`, `Strings`, `Horns`, `Dub / Lead Bass`)
       - `audio_samples` (**Audio Samples**, 6 codes; `NONE` has `"hidden_in_ui": true` and MUST be omitted from filter options and public song badges: `Advocate Speech`, `Documentary / News`, `Slaughterhouse Sounds`, `Wildlife / Nature`, `Sound FX / Crowds`)
   - All `label` strings carry **zero emojis** (preserving brand voice).
   - Display text uses `listener_description` on public tooltips/About Reference; keep `ai_definition` internal to the analysis repo.

2. **Update `backend/services/acousticCodebook.js`**:
   - Read the `dimensions` structure (`single_select` vs `multi_select`), replacing reads of `song_lyric_analysis` with `song_audio_analysis` (`LATEST_AUDIO_ANALYSIS`).
   - Emit `${alias}.${col} = ANY($${idx}::text[])` for single-select columns and `${alias}.${col} && $${idx}::text[]` for `TEXT[]` multi-select columns.
   - Omit codes with `hidden_in_ui: true` (`NONE` on `audio_samples`) from `optionsFor()` and public display helpers.

3. **Decouple `backend/services/browseFilters.js`** (and `/search`, `/browse-facets`, `/filter-options`):
   - Add a dedicated `joins.audioAnalysis` (`LEFT/INNER JOIN <LATEST_AUDIO_ANALYSIS> saa ON saa.song_id = s.id`) instead of piggybacking acoustic filters on `sca` (`LATEST_ANALYSIS` from `song_lyric_analysis`).
   - Move `tempo_from` / `tempo_to` filters from `sca.tempo_bpm` to `saa.tempo_bpm`.
   - Keep `sca` strictly for lyrical scalar metadata (`perspective`, `lyrical_tone`, `clarity`, `focus_amount`, `target_audience`, `emotions`).
   - **Result**: Sound filters and Tempo range immediately cover **`1,266`** audio-analyzed songs instead of stopping at lyric-coded songs.

---

## 4. Update `backend/services/explore.js` & `exploreRegions.js` (Explore Map + Similar Sound)

1. **Similar Sound tab (`SIMILARITY` in `backend/services/explore.js`)**:
   - Replace `{ key: 'sound', label: 'Similar sound', column: 'audio_embedding', dims: 6, metric: 'zeuclidean' }` with:
     ```js
     { key: 'sound', label: 'Similar sound', column: 'audio_hybrid_embedding', dims: 574, metric: 'cosine' }
     ```
   - `cosineSql(entry)` already enforces `array_length(se.${entry.column}, 1) = (SELECT array_length(v, 1) FROM target)` and returns empty cleanly when a song lacks `audio_hybrid_embedding`, falling back cleanly when neither tab has data.
   - Because `audio_hybrid_embedding` (`574D Hybrid-C`) is **the exact same vector** that builds `song_coordinates.audio_2d` / `audio_3d`, **"Similar sound"** recommendations on Song Pages match neighborhood proximity in **Sound Space** on the Explore Map.

2. **Decoupled `audio` ("Sound") Space Coverage in `mapRows` (`explore.js`)**:
   - Currently `mapRows` filters `WHERE s.status = 'included' AND s.published = true AND ${ELIGIBLE('s')}` — which hides `662` audio-coded songs that have no lyrics!
   - Update `mapRows` to:
     - `LEFT JOIN song_coordinates sc ON sc.song_id = s.id`
     - `LEFT JOIN <LATEST_AUDIO_ANALYSIS> saa ON saa.song_id = s.id`
     - Require `s.status = 'included' AND s.published = true AND ((${ELIGIBLE('s')} AND sc.thematic_2d IS NOT NULL) OR (saa.song_id IS NOT NULL AND sc.audio_2d IS NOT NULL))`
     - Set lyric-space fields/coords (`thematic`, `holistic`, theme codes) only when `ELIGIBLE('s')` is true so `thematic` (`635` published songs) and `holistic` (`604` songs) stay gated on verified lyrics, while `audio` (**"Sound"**) serves **all `1,266` `OK` audio songs**!
     - Read V2.1 single-select audio columns from `saa.*` instead of `sla.*`.

3. **Explore Map Colour-By Palette Compatibility (`palette.js` 7-colour cap)**:
   - Replace legacy 5 acoustic dimensions in `COLOUR_DIMENSIONS` with V2.1 single-select columns from `saa`:
     - `sonic_intensity` (`Intensity`, 5 codes)
     - `production_texture` (`Sound`, 7 codes)
     - `dynamic_arc` (`Dynamics`, 7 codes)
   - Keep multi-select `musical_mood` (9 codes), `vocal_style`, `instrumentation`, `audio_samples`, and 8-code `rhythmic_feel` in Browse sidebar + Song Cards (unless `palette.js` groups long tails).

4. **Sound Space Region Labels (`labelItems` in `explore.js` -> `exploreRegions.js`)**:
   - Currently `labelItems` feeds ONLY lyrical `THEME_DIMENSIONS` + `genre` into `buildTieredLabels`, which leaves the `662` audio-only songs with zero terms in Sound Space!
   - When `space.key === 'audio'`, feed V2.1 acoustic descriptors from `saa` (`sonic_intensity`, `production_texture`, `rhythmic_feel`, `vocal_style`, `musical_mood`) alongside `genre` (with `labelOf` resolving via `acousticCodebook.js`), so Sound Space cluster labels describe actual musical styles (e.g., *Screamed / Growled · Metal*, *Blast Beats · Hardcore*, *Acoustic Guitar · Folk*).

---

## 5. Song Page Additions (Public Listener View)

When `saa` (`audio_status = 'OK'`) exists for a song:
- **Sound Summary**: Display `saa.sonic_summary` (1 plain-English sentence).
- **Sound Profile Badges**: Display `sonic_intensity`, `production_texture`, `rhythmic_feel`, `dynamic_arc`, `musical_mood[]`, `vocal_style[]`, `instrumentation[]` using `acousticCodebook.js` plain-English labels, plus objective `saa.tempo_bpm` BPM and `saa.musical_key` (`saa.loudness_lufs` / `saa.dynamic_range_lra` optional in technical metadata).
- **Featured Audio Samples (`saa.sample_details`)**:
  - Render only when `audio_samples` contains non-`NONE` items and `sample_details` is non-empty (and `songs.show_audio_samples === true`).
  - Display `description`, `timestamp`, and `transcript_excerpt` (if present).
  - Display **`speaker_or_source` attribution ONLY when `identification_confidence === 'HIGH'`** (or curator-verified); hide or show `"Unidentified source"` when `UNIDENTIFIED`/`MEDIUM`.
- **Interactive 80-Bin Song Audio Timeline (`saa.audio_timeline`)**:
  - See full integration, palette, and UI/UX specification in **`docs/MAIN_PROJECT_AUDIO_TIMELINE_HANDOFF.md`**.

---

## 6. Admin Workbench: Option B Genre Choice & Conflict Queues (`curation.js`)

Because `vegan-playlist-analysis` leaves `songs.genre` untouched (Option B), add two Admin review queues driven by `song_audio_analysis` (`audio_status = 'OK'`):

1. **`genre-from-audio` Queue** (**`269` live songs ready**):
   - Songs where `s.status = 'included'` AND `songs.genre` is empty AND `artists.genres` is empty AND `saa.inferred_subgenre IS NOT NULL`.
   - Displays Gemini's `inferred_parent_genre / inferred_subgenre` (plus `inferred_secondary_genre`, `genre_confidence`, and `genre_rationale`) alongside the embedded YouTube player and `sonic_summary`.
   - Action **"Use Audio Genre"**: sets `songs.genre = saa.inferred_subgenre`, `songs.parent_genre = getParentGenre(...)`, and `songs.genre_source = 'audio_gemini'`.

2. **`genre-conflicts` Queue** (**`412` live songs ready**):
   - Songs where existing `EFFECTIVE_GENRE_EXPR` has parent `P_existing` (`!= 'other'`) AND `saa.audio_status = 'OK'` AND `saa.inferred_parent_genre != P_existing`.
   - Surfaces **Current (Song or Artist)** vs. **Audio-Inferred (`saa.inferred_*` + `genre_rationale`)** side-by-side so the curator can:
     - **Choose Audio Genre** → writes `songs.genre = saa.inferred_subgenre`, `songs.parent_genre = saa.inferred_parent_genre`, `songs.genre_source = 'audio_gemini'`.
     - **Keep Existing Genre** → if `songs.genre` is present, sets `songs.genre_source = 'manual'`; if currently inherited from artist, writes effective artist genre to `songs.genre` with `songs.genre_source = 'manual'` (or stores a dismissal flag) so the conflict leaves the queue.
