# Lyric V2 & Multilingual Embeddings Handoff (`vegan-playlist`)

This specification aligns `vegan-playlist` with the completed **Tier 1 + Tier 2 Lyric & Embedding Upgrades**, **Refreshed Plain-English `sonic_summary`**, **Option B Multi-Language (`detected_languages`)**, **Tier 3 Lyric V2 Pilot**, and **Live Tier 4 Spoken/Advocacy Audio Transcripts** now in shared PostgreSQL `vegan_playlist`.

> **Privacy Rule Unchanged**: Full lyric text (`song_lyrics.lyrics`, `song_lyrics.translation`) AND Tier 4 raw audio transcripts (`song_audio_transcripts.transcript`) are **LOCAL / ADMIN ONLY** (enforce alongside `backend/test/lyrics_privacy.test.js`). Never select or expose `transcript` on public routes.

---

## 1. Live Database State Ready Right Now in `vegan_playlist`

1. **Multilingual Long-Context Lyric Embeddings (`BAAI/bge-m3`, `1024D`)**:
   - `song_embeddings.lyric_embedding` uses **`BAAI/bge-m3` (`1024D`, 100+ languages, `8,192`-token window)** computed over Genius-boilerplate-stripped lyrics (plus `song_lyrics.translation` when present).
   - Coverage: **`693`** included songs (**`679 / 679`** published real-lyric songs; `0` missing/stale), with **`46`** stale junk/blank embeddings cleared.
   - `lyric_embedding_model = 'BAAI/bge-m3'` is populated for provenance checks.

2. **Persisted `1188D` Lyric-Hybrid Vectors (`song_embeddings.lyric_hybrid_embedding`)**:
   - **`672`** published (**`683`** total persisted) L2-normalized **`1188D`** vectors (`lyric_hybrid_model = 'bge-m3-1024c_qual1.0_sem0.65'`), combining:
     `1.0 × Qualitative Codes (themes, topics, advocacy [replacing drifted tactics], moral_frames, scalars, emotions) + 0.65 × Centered 1024D BGE-M3`.
   - **Recommended `vegan-playlist` update (`backend/services/explore.js` -> `SIMILARITY`)**:
     Switch `{ key: 'message', column: 'lyric_embedding', dims: null }` to:
     ```js
     { key: 'message', label: 'Similar message', column: 'lyric_hybrid_embedding', dims: 1188, metric: 'cosine', lyricDerived: true }
     ```
     This aligns **"Similar message"** on Song Pages directly with **Thematic Space** on the Explore Map (matching how `Similar sound` uses `audio_hybrid_embedding` with `dims: 574`).

3. **Clean UMAP Projections & Plain-English `sonic_summary` (`song_coordinates` & `frontend/public/vector_space.json`)**:
   - `project_and_export.py` mirrors `analysis.js`'s `LATEST_ANALYSIS` / `NOT_JUNK` logic and encodes **`advocacy`** instead of `tactics`.
   - Live export & `song_coordinates`: **`1,311`** exported rows (**`686`** with 1024D lyric embeddings, **`1,267`** audio, **`642`** holistic).
   - All **`1,267 / 1,267`** `OK` `song_audio_analysis.sonic_summary` strings were refreshed via batched `gemini-3.8-flash` into everyday plain English (`14..22` words, median `18`; jargon/fluff regex hits reduced `772 -> 0`) and synced into `frontend/public/vector_space.json`.

4. **Placeholder Stubs Found in `song_lyrics` (`backend/services/lyricsQuality.js` Note)**:
   - Audit uncovered **`10`** published songs whose `song_lyrics.lyrics` is an unflagged placeholder stub rather than real lyrics: `'\n'` (`4807`), `'NA'` (`5493, 5539, 5540, 5554, 5562`), `'[object Object]'` (`4846`), `'Lyrics on spotify'` (`5138`), and `'Transcribe from song'` (`5570, 5571`), plus **`227`** songs starting with Genius `"N Contributors\n... Lyrics"` headers (stripped in-memory in analysis; `song_lyrics.lyrics` untouched). Adding placeholder detection to `lyricsQuality.js` moves those `10` cleanly into `junk-lyrics` / `needs-lyrics`.

---

## 2. Option B Multi-Language Detection (`detected_languages TEXT[]`)

Consistent with `009_multi_language.sql` (`songs.language TEXT[]`) and Option B curator provenance (**the analysis repo NEVER overwrites `songs.language`**, which currently sits untouched at `126` published songs):

- **Added columns on `song_lyric_analysis`**:
  ```sql
  detected_languages  TEXT[],      -- Ordered primary-first canonical names matching 009_multi_language.sql (e.g. ['English'], ['Spanish', 'English'], ['Māori'])
  language_confidence VARCHAR(16)  -- 'HIGH' | 'MEDIUM' | 'LOW'
  ```
- **Two live sources currently populated in `vegan_playlist`**:
  - **`song_audio_transcripts.detected_languages`**: **`91 / 91`** live spoken/advocacy rows (`English=89`, `Hebrew=2`, `French=1`, `Spanish=1`, including bilingual tracks like ID `232` *Kaporos* `['English', 'Hebrew']` and ID `4978` `['French', 'English']`).
  - **`song_lyric_analysis.detected_languages` + `language_confidence`**: **`11`** `gemini-4-hydrogen` pilot rows currently populated (`English=9`, `Māori=1`, `Spanish=1`, `German=1`); remaining **`682`** non-junk lyric songs are staged on hold pending the full Lyric V2 run.
- **Integration with existing `needs-language` / Admin Workbench (`backend/services/curation.js`)**:
  Mirror the existing `audio_genres` / `chooseGenre` curator-approval pattern: surface `COALESCE(sla.detected_languages, sat.detected_languages)` alongside `sla.language_confidence` / `sat.confidence` as one-click suggested languages in `needs-language` and `getWorkbench` (writing to `songs.language` only when curator-approved), plus optional discrepancy badges when detected languages differ from curator `songs.language`.

---

## 3. Tier 3 (Multi-Agent Lyric V2) & Live Tier 4 Audio Transcripts

- **`LATEST_ANALYSIS` Automatic Pickup (`backend/services/analysis.js`)**:
  `run_gemini_lyric_coding.py` (`gemini-4-neon` Orchestrator -> `gemini-4-hydrogen` B1 Analyser with accessible `lyric_summary` prompt, `tactics = advocacy`, `analyzed_at = NOW()`, zero lyric truncation, and `detected_languages TEXT[]` -> conditional `gemini-3.8-flash` Reviewer with `thinkingBudget=4096`) currently has **`11` pilot rows** live in `song_lyric_analysis` (full `682`-song run on hold). Because `analysis.js` `LATEST_ANALYSIS` orders by `analyzed_at DESC`, new V2 codings take precedence over legacy `gemini-3.5-flash-lite` rows automatically.

- **Tier 4 Audio Transcripts (`song_audio_transcripts`) — `622` Tracks Live (`570 OK`, `52 UNINTELLIGIBLE`)**:
  Populated by `src/core/transcribe_audio_lyrics.py` using **`gemini-4-hydrogen`** (`--thinking-budget 0`) and isolated strictly from `song_lyrics`.
  - **Live right now**: **`91`** spoken/advocate-speech tracks (`OK`) + **`531`** remaining cached vocal tracks (`479 OK`, `52 UNINTELLIGIBLE`, `0` errors) with calibrated confidence evaluation (`185 HIGH`, `96 MEDIUM`, `250 LOW`).
  - **Exact `song_audio_transcripts` columns**:
    `song_id`, `model_used`, `youtube_id_used`, `status`, `transcript`, `detected_languages TEXT[]`, `word_count`, `confidence`, `confidence_score` (`SMALLINT 0..100`), `estimated_word_accuracy_pct` (`SMALLINT 0..100`), `audio_clarity` (`CLEAR | MODERATE | MUDDY_OR_BURIED | EXTREME_UNINTELLIGIBLE`), `confidence_notes` (`TEXT`), `inaudible_segments` (`INTEGER`), `prompt_tokens`, `output_tokens`, `error_message`, `transcribed_at`, `promoted_to_lyrics`.
  - **Recommended Admin Workbench wiring (`backend/services/curation.js`)**:
    In `getWorkbench` (and queues like `needs-lyrics` / `to-transcribe`), query:
    ```sql
    SELECT song_id, model_used, youtube_id_used, status, transcript,
           detected_languages, word_count, confidence,
           confidence_score, estimated_word_accuracy_pct,
           audio_clarity, confidence_notes, inaudible_segments,
           transcribed_at
    FROM song_audio_transcripts
    WHERE song_id = $1 AND status IN ('OK', 'UNINTELLIGIBLE')
    ```
    Surface this as an **editable AI draft transcript** with confidence badge (`confidence`, `confidence_score/100`, `audio_clarity`, `inaudible_segments`, and `confidence_notes`) in the admin workbench so the curator can prioritize `HIGH`-confidence drafts for quick approval into `song_lyrics` via `saveLyrics` and flag `LOW`/`UNINTELLIGIBLE` tracks for manual lookup. Keep `song_audio_transcripts.transcript` excluded from all public routes (`backend/test/lyrics_privacy.test.js`).
