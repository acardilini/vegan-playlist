# Audio switch (Step B): the website and admin move to the new audio analysis

Date: 2026-11-22 · Branch: `session-audio-switch` · Status: awaiting curator approval

## Intent and why

The analysis project now listens to each song's audio (Gemini) and writes a complete description into
`song_audio_analysis`: eight coded dimensions, a one-sentence sound summary, measured tempo / key / loudness,
embedded-sample details and an inferred genre. 1,266 of 1,343 live songs have a usable row (one model,
`gemini-4-hydrogen`; one OK row per song). It supersedes the old audio data (the six acoustic columns on
`song_lyric_analysis`, the Spotify-era `songs.energy` / `danceability` / `valence` / `tempo` fields and the legacy
`audio_embedding` columns). The curator's instruction: **the new data replaces the old everywhere; no old connection
may remain on the website.** The new `acoustic_codebook.json` has already been copied over the old one, which is why
the old Sound code is broken on this branch (10 tests fail) until this work lands.

## Goals

1. **Song page:** a section named **The Sound** replaces "In the sound" (the Sound rows leave "Style & tone", which
   becomes lyrics only). It shows the **sound summary** (the one-sentence description), two columns of rows (Mood,
   Intensity, Sound/production, Dynamics | Vocals, Rhythm, Instruments, Tempo · Key) and a folded **Samples heard (N)**
   list. Curator-approved layout B with the samples folded (mockup: `.superpowers/brainstorm/.../song-audio-layout.html`).
2. **Samples are curator-gated:** the admin chooses per song whether its sample details may appear. Hidden samples
   are never sent to the browser.
3. **Browse filters:** the Sound filter group is rebuilt on the new dimensions; old filters and URL keys are removed.
4. **Cards:** the mood badge shows the audio mood instead of the old hand-entered `custom_mood`.
5. **Remove every old audio connection** from public responses, queries, admin writers, front-end code and docs
   (the DB columns stay; nothing reads or writes them).
6. **Similar sound** (song page tab) reads the new hybrid audio embedding.
7. **About pages:** the Reference tab and the explainer describe the new method truthfully (draft copy at the end
   for the curator to approve; the prose is curator-owned).
8. **Admin:** an Audio panel on the workbench (read-only analysis + the samples decision) and an
   "Audio samples to review" queue.

## Non-goals (not in this step)

- The Explore map: wider point set (audio-only songs), region labels from audio, new colour dimensions
  (Step C). In this step the map only loses its old colour options (see Explore below).
- The broken-YouTube-link queue and oEmbed checker (its own small step, Step D, built after this).
- Per-sample (rather than per-song) visibility; editing or correcting AI codes from the admin.
- Any write to `song_audio_analysis` or `song_embeddings` (the web app stays a read-only consumer).
- Using `sonic_evidence` (internal reasoning) publicly.

## Anti-goals (would make this a failure even if it technically works)

- A hidden sample's transcript, timestamp, description or even its type reaching any public response or the
  public filter counts.
- Any public read still touching `songs.energy` etc., `song_lyric_analysis.sonic_energy` etc. or the legacy
  `audio_embedding` columns, or an admin form still writing them.
- The About pages still saying the sound dimensions are "measured, not judged", or that the mood badge is
  hand-entered, once they no longer are.
- Risking the 650-song curated dataset: no migration rewrites existing rows; the one new column is additive.

## Data facts the design rests on (read-only queries, 2026-11-22)

- 1,266 OK rows for 1,343 live songs; every field filled on every OK row except tempo (1,255; the 12 `UNMETERED`
  songs have a tempo for 1 only).
- 95% of songs have two moods (1,209 of 1,267), the rest one; instruments 0-4 per song (11 have none).
- Samples: 385 live songs have at least one non-`NONE` sample (every one has structured details): speech 106,
  documentary/news 116, slaughterhouse sounds 57, wildlife 37, other sound effects 117.
- Sound summary is 114-200 characters on every row.
- Key estimates are weak on the whole (`key_confidence` median 0.065), so the key is shown as an estimate.
- Codes are stored UPPER_SNAKE (`FEROCIOUS_AGGRESSIVE`); labels come from the codebook (`label`, e.g. Aggressive).

## Decisions (as decided by the curator unless marked "my call")

**Which row.** A song's audio is its OK row from `song_audio_analysis` with the latest `analyzed_at` (today
exactly one). A shared SQL fragment, `LATEST_AUDIO`, mirrors `LATEST_ANALYSIS`; every audio read uses it. A song with
no OK row has no Sound section, no sound filter values and no mood badge. (my call)

**Codebook service.** `services/acousticCodebook.js` is rewritten over the new file's shape (`dimensions{key:{name,
selection_mode, min/max_select, codes[{code,label,listener_description,ai_definition,hidden_in_ui}]}}`,
`objective_metrics`, `sample_details_schema`). It stays pure (no DB). Display is ungated (an off-codebook code
title-cases instead of vanishing); filter selections are gated through `cleanSelection`. `hidden_in_ui` codes
(`NONE`) never display or filter. The dimension list is read from the file, not hard-coded, except the order used on
the page. Public text uses `listener_description`; `ai_definition` is used only on the Reference page.

**Filters.** One filter per dimension that has a code list: Mood, Intensity, Sound (production), Vocals, Rhythm,
Instruments, Dynamics, plus a Tempo range (BPM from the audio table) and **Audio samples** (gated, below). Multi-value
dimensions (mood, vocals, instruments) match a song if **any** selected code is in its array (`&&`); single-value
dimensions use `= ANY`; OR within a dimension, AND across dimensions, counts are "exclude-self" per dimension, as
the existing acoustic filters work. URL keys are the new dimension keys (`musical_mood`, `sonic_intensity`,
`production_texture`, `vocal_style`, `rhythmic_feel`, `instrumentation`, `dynamic_arc`, `audio_samples`,
`tempo_from`, `tempo_to`). Old keys (`sonic_energy`, `emotional_mood`, `rhythmic_style`, `acoustic_type`,
`vocal_delivery`) are simply no longer recognised; old bookmarked links lose those filters (curator-approved).

**Samples gate.** New column `songs.show_audio_samples BOOLEAN NULL` (migration 021, additive, no backfill):
NULL = not reviewed (treated as hidden), TRUE = show, FALSE = hidden after review. Public rule: a song's sample
details and its `audio_samples` filter membership exist publicly only when `show_audio_samples IS TRUE`. The server
removes the data; the page never hides it with CSS. The song page's folded list shows, per sample: type label,
timestamp range, description, transcript excerpt (when there is one) and the source (when certain). (the folded
list design is the curator's; field choice is my call)

**Tempo and key.** Tempo is shown as `107 BPM` when present (hidden for `UNMETERED`/null); key as `F major`. The
tooltip says both are estimated by software. Tempo filters on the audio table's `tempo_bpm`. (my call)

**Mood badge.** `musical_mood[1]` (first-listed) of the song's audio row, as its codebook label; none when no row.
`MoodBadge` takes the label from the API (`song.mood`); the old label map and `custom_mood` are removed. (my call)

**Similar sound.** The `sound` entry in `explore.SIMILARITY` moves from the legacy 6-D z-scored `audio_embedding`
to `audio_hybrid_embedding` (574-D, cosine, rows where `array_length(audio_hybrid_embedding,1)=574`); "More in this
genre" fallback unchanged. (my call: moved into this step from Step C so no old audio connection survives)

**Explore (this step only).** The five old Sound colour-by dimensions are removed from the menu and the default
colour becomes `genre` (`DEFAULT_COLOUR` in `exploreUrlState.js`); stale `colour=` links already fall back to the
default. The new colour dimensions come in Step C. (my call)

**Public API cleanup.** `energy`, `danceability`, `valence`, `acousticness`, `tempo`, `instrumentalness`,
`liveness`, `speechiness`, `loudness`, `custom_mood` are removed from every public select
(`routes/spotify.js`, `routes/playlists.js`; includes the aggregate AVG query near the stats route, which the
builder should inspect: drop it if nothing reads it). The same names are removed from the admin legacy create/update
writers in `routes/admin.js` (`custom_mood` too, now unused). Columns stay in the database.

**Dead front-end code.** `frontend/src/utils/audioFeatures.js` (imported nowhere) is deleted;
`browseUrlState.js`, `SearchAndFilter.jsx`, `ScalarFacetGroups` (usage text), `LyricalAnalysis.jsx`, `MoodBadge.jsx`,
`AnalysisReference.jsx` and the explore URL tests are updated.

**Legacy-name guard.** A node test scans `backend/{routes,services,utils}` and `frontend/src` for the retired
identifiers (`sonic_energy`, `emotional_mood`, `rhythmic_style`, `acoustic_type`, `vocal_delivery`, the old
`acoustic_facets` key, `s.energy`, `s.danceability`, `s.valence`, `custom_mood`, `audioFeatures`) and fails if any
reappear. Allow-list: the migration files and docs.

**Admin.** The workbench gets an **Audio** panel: the song's audio analysis read-only (codes as labels, sound
summary, tempo/key/loudness, status, the full sample list for the curator whatever the gate says) and the
**Show samples on the song page** control (Show / Hide / Not reviewed; a plain three-state choice that saves
immediately, `PUT /api/admin/workbench/:id/audio-samples`). New rail/Dashboard queue **Audio samples to review**:
included songs with at least one non-NONE sample whose `show_audio_samples IS NULL` (about 385 live, falling as the
curator decides). The panel reads the row through the same service the page uses.

**Coverage.** The Reference payload's `coverage` block gains `audio: {analysed, pct, models, latest}`; the
explainer gets tokens `{{audioAnalysed}}`, `{{audioAnalysedPct}}`, `{{audioModels}}`, `{{audioDate}}`.
77 live songs have no usable audio (about 251 across the whole catalogue are YouTube-gated and may never be
analysed); the About copy says so plainly.

## Constraints

- The web app only reads `song_audio_analysis`; `acoustic_codebook.json` is owned by the analysis project (synced
  into `backend/data/` by its tooling; do not hand-edit).
- Admin routes stay password-protected; public routes keep the `status='included' AND published=true` gate.
- `song_lyrics` stays local-only; sample transcripts are short excerpts but are third-party speech, which is why they
  are gated by the curator.
- No new paid services. No new front-end dependency.
- Backend tests are serial (`node --test --test-concurrency=1`) with a unique fixture sentinel per file.

## Left to the builder

- Exact SQL for `LATEST_AUDIO` joins and the shared gate helper (`samplesVisibleSql`), and where facet counts live
  (`analysis.js` vs a new `audioAnalysis.js`); the old acoustic code should be deleted, not left beside the new.
- The visual detail of The Sound section within the existing `la-*` styles (reuse the Style & tone card vocabulary and
  the fold pattern from "Show quotes"); the sidebar Sound group's sub-grouping.
- Whether `getSongAnalysis` grows an `audio` block or the page makes one call for it (prefer one extra block in the
  same response).
- Test fixtures: tests must create their own `song_audio_analysis` rows under a new sentinel and clean them up.

## Verification

Backend suite serial, frontend node tests, lint, build; spare-port live checks that (a) a hidden-sample song's
`/api/analysis/songs/:id` carries no sample data and no `audio_samples` in facet counts, (b) the filters return
what the counts say, (c) no public response contains the retired field names; a headless render of The Sound section
in the real component for a song with samples shown, hidden and absent audio. The curator smoke is written in chat.

## Calls I made (change any)

1. Latest OK row per song; no OK row means no Sound section.
2. Public text from `listener_description`; Reference shows `ai_definition`.
3. Tempo hidden when unmetered; key shown as an estimate.
4. Card badge = first-listed mood.
5. Similar sound switched to the hybrid embedding here (not Step C).
6. Explore loses its old colour options now; new ones arrive in Step C.
7. Samples gate stored as one nullable column on `songs` (tri-state), not a new table.
8. Legacy admin writers for the old fields are removed, not hidden.

## Questions for the curator (answers change what gets built)

See the end-of-design message; each has a recommended answer.

---

## Appendix: draft replacement copy for `backend/data/analysis.md` (for the curator to approve or rewrite)

The curator owns this prose; nothing below is applied until approved. Changed sections only.

**Replace "Measuring the sound" with:**

> ## Listening to the sound
>
> The sound of each song is described by an AI model that listens to the recording itself. It applies a second
> codebook, written by hand like the first, covering the mood of the music, its intensity, its production style, its
> vocal delivery, its rhythm, its instruments, how it moves from start to finish, and any non-musical audio samples
> in it (a speech clip, a news report, animal sounds). It also writes a one-sentence summary of how the track
> sounds. The [Reference](/about/reference) page lists every code with its definition.
>
> Alongside that, audio-analysis software measures the things that can be measured directly: the tempo, the
> loudness and an estimate of the musical key. Those are numbers taken from the waveform, not judgements, although
> a key estimate in particular can be wrong.
>
> Where a song contains audio samples, whether their details appear on its page is the curator's decision.

**In "Placing songs next to each other"**, replace the Sound-space sentence and the second paragraph with (to be
re-checked against what Step C builds):

> Its Sound space is positioned by an audio model's reading of the recording together with the sound codes.
> ...the other compares what they *sound like*, using that audio reading.

**In "Where the rest of the information comes from"**, replace both paragraphs with:

> A song's genre starts from Spotify's genre for the artist; the curator can set it by hand or accept the genre the
> AI hears in the audio, and the choice is recorded. Album and release date come from Spotify.
>
> The mood badge on a song card is the first mood the AI hears in the recording. Languages and the highlighted
> lyrics on a song page are entered by hand.

**In "Where AI is used"**, replace the sound bullet with:

> - **The per-song sound coding: AI.** A Gemini model listens to the audio and applies the sound codebook, and writes
>   the sound summary. **Tempo, loudness and key: measured** by software. The audio reading also places a song on the
>   Explore map's Sound space and drives the "Similar sound" tab on a song page.

and change the Holistic sentence to match what the map does at Step C (currently it says "part measurement").

**Add to "What this doesn't tell you":**

> **Not every song has been listened to.** {{audioAnalysed}} of {{songs}} songs have a sound analysis
> ({{audioAnalysedPct}}). Some recordings could not be fetched, so those songs have no sound description yet.
>
> **The sound coding is machine-generated and unchecked**, like the lyric coding. The key estimate is the least
> reliable number on a song page.
