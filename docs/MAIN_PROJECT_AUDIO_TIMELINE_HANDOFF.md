# Song Page Audio Timeline Visualizer — Handover Specification (`vegan-playlist`)

This specification documents the new per-song **80-bin `audio_timeline` dataset** now live in shared PostgreSQL `vegan_playlist`, the exact backend contract updates for `vegan-playlist`, and the curator-approved visual/UX requirements for building the Song Page timeline component natively in `vegan-playlist`.

> **Design Integration Note for the Main Project Agent**:
> Please review `SongDetailPage.jsx`, `frontend/src/styles/tokens/colors.css`, and `frontend/src/styles/components.css` so this component uses the site's native typography (`--text-*`), surfaces (`--bg-surface`, `--bg-surface-raised`, `--border-hairline`), pull-quote styling (`.lyrics-passage` left Ember rule), and spacing cleanly. Treat the interactive HTML concept mockup as a functional/colour-contrast reference, not rigid CSS.

---

## 1. Live Database Contract (`song_audio_analysis.audio_timeline`)

All `1,267` `OK` tracks in `song_audio_analysis` (`model_used = 'gemini-4-hydrogen'`) are populated (**`1,267 / 1,267`**, total JSONB footprint **`1,153 kB`**, average **`931.9 bytes`** per song, durations **`12.6s` – `869.47s`**). Future songs receive `audio_timeline` automatically during Phase 1 MIR extraction, and changing a song's primary `youtube_videos` link automatically invalidates stale timelines (`src/core/cache_audio.py`).

### JSONB Schema
```json
{
  "version": "v1",
  "bins": 80,
  "duration_sec": 186.0,
  "bin_sec": 2.325,
  "loudness": [0.468, 0.535, "... (80 floats in 0.0..1.0)"],
  "grit":     [0.857, 0.945, "... (80 floats in 0.0..1.0)"],
  "pulse":    [1.0,   0.895, "... (80 floats in 0.0..1.0)"]
}
```

### Curve Definitions (Computed in `src/core/run_audio_mir_and_embeddings.py`)
Extracted from mono `22,050 Hz` audio (`n_fft=2048`, `hop_length=512`, up to `900s`) averaged over `80` equal time bins:
- **`loudness` (`0.0..1.0`)**: Global dBFS loudness mapped linearly across `-42 dBFS` (`0.0`) to `-4 dBFS` (`1.0`). Because the scale is **global across the catalog** (not per-song min-max), quiet acoustic folk songs stay visibly calmer than loud punk/metal tracks.
- **Silence gate**: `gate = clamp((rms_db + 42) / 10, 0, 1)` multiplies both `grit` and `pulse` so silent intros, pauses, and trailing silences cleanly decay to `0.0` (verified `0` noise-floor spikes across all `2,803` silent bins in the `1,267`-song dataset).
- **`grit` (`0.0..1.0`)**: Spectral roughness / harmonic harshness combining normalized zero-crossing rate and spectral flatness (`0.5 * (zcr / 0.18) + 0.5 * (flatness / 0.14)`), clipped to `[0, 1]` and silence-gated. High on distorted guitars, harsh screams/growls, cymbals, and noisy textures; low on clean vocals, acoustic strums, and warm synth pads.
- **`pulse` (`0.0..1.0`)**: Rhythmic transient strength normalized by `max(p95(onset_strength), 0.35)`, clipped to `[0, 1]` and silence-gated. The `0.35` floor prevents quiet ambient/drone tracks from inflating tiny fluctuations to `1.0`.

> **Performance Guardrail**: **NEVER** select or serialize `audio_timeline` in list/map endpoints (`/api/spotify/search`, `/api/analysis/explore/points`, Browse cards). Fetch it **only** in single-song detail queries.

---

## 2. Backend Wiring in `vegan-playlist`

Currently `backend/services/audioAnalysis.js` implements `getSongAudio(db, songId)` -> `buildBlock(row, { withSamples })` cleanly (though it is not yet attached to a public song route such as `/api/analysis/song/:id` or `/api/spotify/songs/:id`).

Update `backend/services/audioAnalysis.js`:

1. **Expose `timeline` in `buildBlock(row, { withSamples })`**:
   ```js
   timeline: row.audio_timeline && row.audio_timeline.version === 'v1' ? row.audio_timeline : null,
   ```
2. **Parse & expose `sections` from `row.sonic_evidence` in `buildBlock`**:
   `sonic_evidence` is a JSONB array of timestamped descriptions (e.g. `"0:00-0:48: Dark, sustained ambient synth pads underscore a calm spoken-word documentary narration..."` or `"0:16-1:23 Settles into a steady 143 BPM..."`). Parse into structured spans for hovering/clicking on the timeline:
   ```js
   // Handles "M:SS-M:SS: text", "M:SS–M:SS text", "M:SS text", or plain fallback text
   // Returns [{ startSec, endSec, label, text }]
   ```
   Keep graceful fallback to an un-timed bullet/note list if a track lacks parseable timestamps.
3. **Preserve Strict Curator Sample Gating (`songs.show_audio_samples`)**:
   - Keep `withSamples: row.show_audio_samples === true` in `getSongAudio(db, songId)`.
   - Never expose `samples` (neither highlight spans on the graph nor quote cards underneath) on public Song Pages unless `show_audio_samples IS TRUE`.
   - `getAdminAudio(db, songId)` continues to return `{ withSamples: true }` + `timeline` so the curator can inspect the timeline and speech spans before approving `show_audio_samples`.
4. **Fix Missing `identification_confidence` Gate in `buildSamples(row)`**:
   - Currently `backend/services/audioAnalysis.js` lines `53–60` forward `source: d.speaker_or_source || null` without checking `d.identification_confidence`.
   - Update `buildSamples(row)` so **named attribution (`source`) is exposed ONLY when `d.identification_confidence === 'HIGH'`** (otherwise return `source: null`, which the UI renders as `"Unidentified speaker"` / `"Unidentified source"`, plus expose `confidence: d.identification_confidence || null`):
   ```js
   source: d.identification_confidence === 'HIGH' ? (d.speaker_or_source || null) : null,
   confidence: d.identification_confidence || null,
   ```
   Also parse sample `timestamp` strings (e.g. `"0:44-1:19"`, `"1:56-1:57"`) into numeric `startSec` / `endSec` (or convert frontend-side) so sample spans align cleanly onto the 80-bin axis.

---

## 3. UI & Visualization Specification (Incorporating All Curator Refinements)

The approved design merges the **Sonic Ribbon** (mirrored smoothed `loudness` envelope over time) with **two toggleable overlay curves (`Grit` & `Beat Pulse`)**, interactive **Sample / Advocacy highlight spans** (when curator-approved), and subtle vertical **`sonic_evidence` section boundaries**.

### Curator-Mandated Refinements (Must Follow All 4)

1. **High-Contrast, Colour-Blind-Safe Palette + Dual Encoding**:
   - Muted pastel overlays proved hard to distinguish and risky for colour-vision deficiency (CVD).
   - Align with `vegan-playlist`'s warm-neutral dark canvas tokens (`frontend/src/styles/tokens/colors.css`: `--bg-canvas`, `--bg-surface`, `--bg-surface-raised`) and `frontend/src/styles/components.css` (`--explore-cat-1..7` / `validate_palette.js --pairs all`).
   - Encode every curve and sample region with **two independent visual channels** (high-contrast hue/luminance + distinct stroke/pattern) so the chart stays readable under Protanopia, Deuteranopia, Tritanopia, and greyscale:
     - **Sonic Ribbon (`loudness`)**: Subtle, translucent cool neutral-blue envelope (`rgba(112, 142, 205, 0.22)` to `rgba(70, 79, 252, 0.36)`) with low luminance saturation so overlay strokes stay razor-sharp.
     - **Grit (`grit`)**: **Solid stroke** (`2.2px`) in bright **Ember / Vermilion-Orange** (e.g. `#ff7d3b` on `--bg-surface`), rendered cleanly above the ribbon.
     - **Beat Pulse (`pulse`)**: **Dashed stroke** (`[6, 4]`, `2.2px`) in bright **Sky / Cerulean Blue** (e.g. `#38bdf8` on `--bg-surface`), maximally separated from Vermilion-Orange across red-green and blue-yellow CVD axes and distinguishable by dash pattern alone.
     - **Sample / Advocacy Spans (curator-approved)**: High-contrast **Orchid / Magenta** (e.g. `#f472b6` / `#e879f9`) vertical translucent band with subtle **diagonal hatch pattern** + crisp top span pill (`Advocate Speech` / `Documentary` / `Slaughter SFX` / etc.).
     - Validate your final chosen CSS token hex/oklch values against `--bg-surface` and each other using your project's `validate_palette.js` script.

2. **No Repeated Grit / Beat Pulse Legends Under the Graph**:
   - Place the interactive **`Grit`** and **`Beat Pulse`** toggle buttons directly in the card's top control bar, each embedding a small visual stroke swatch (a solid horizontal line on the `Grit` button, a dashed line on the `Beat Pulse` button).
   - Those toggle buttons **are** the legend — do **NOT** add a second legend strip below the canvas.

3. **No Ribbon Legend Under the Graph**:
   - Do **NOT** render a gradient "Ribbon intensity / Quiet ↔ Intense" legend bar below the graph. Keep the bottom area completely free of chart-key clutter (per `InfoTip.jsx`, avoid `"i"` icon clutter too; plain concise metric readouts on hover/scrub make the curve self-explanatory, and terminology definitions belong on About → Reference).

4. **No Repeated Song Title, Artist, Genre, or BPM Inside the Visualizer**:
   - `SongDetailPage.jsx` already displays song title, artist links, album, release year, genre, duration, BPM, key, and V2.1 sound badges.
   - Remove all song title / artist / global metadata headers/pills from inside or beneath the visualizer component. Keep **only** information specifically about the **song's breakdown across its duration**:
     - Interactive time-aligned canvas (`0:00` → `M:SS` axis ticks, vertical cursor scrubber).
     - Live/pinned **Bin Readout** strip (`tabular-nums`: timestamp e.g. `1:28`, `Loudness 72%`, `Grit 41%`, `Beat Pulse 85%` — hides `Grit` / `Pulse` readouts if toggled off, or dims them cleanly).
     - **Section Breakdown** strip: displays the timestamped `sonic_evidence` segment overlapping the active timestamp (with subtle previous/next or clickable section pills if multiple sections exist).
     - **Featured Clip / Advocacy Callout** (shown ONLY when `audio.samples` is non-null from curator approval, and synced/highlighted as the user scrubs over or clicks a sample span):
       - Sample category pill (e.g. *Advocate Speech*, *Documentary / News*, *Slaughterhouse Sounds*) + exact timestamp (`0:44–1:19`).
       - **Verified Speaker / Source** shown prominently **when `sample.source` is non-null** (which is gated on `HIGH` confidence server-side), or `"Unidentified speaker"` when omitted.
       - Concise context description (`description`).
       - Verbatim `transcript` rendered cleanly (matching the site's `.lyrics-passage` left Ember accent rule).

---

## 4. Interaction, Accessibility, & Edge-Case Checklist

- **Desktop + Touch Scrubbing**: Use Pointer Events (`pointerdown`, `pointermove`, `pointerup` with `touch-action: pan-y`) so hovering scrubs smoothly on desktop and tapping/dragging pins/scrubs reliably on mobile without trapping vertical page scroll. Click toggles pinning a timestamp (or clicking a sample pill jumps the cursor directly to that clip).
- **Keyboard Accessibility**: Give the timeline canvas/wrapper `tabIndex={0}`, `role="slider"`, `aria-label="Audio structure timeline"`, `aria-valuemin={0}`, `aria-valuemax={durationSec}`, `aria-valuenow={activeTimeSec}`, `aria-valuetext="..."`, stepping `±bin_sec` on `ArrowLeft` / `ArrowRight` and `Home` / `End`.
- **HiDPI & Resize**: Observe container width via `ResizeObserver` and scale `<canvas>` backing store by `window.devicePixelRatio` for sharp retina lines.
- **Empty & Partial States**:
  - `audio === null` or `audio.timeline === null`: Render nothing for the timeline section (fall back cleanly to Sound Summary + profile badges when present).
  - `audio.samples === null` (`show_audio_samples !== true` or `['NONE']`): Render the Ribbon + Grit + Beat Pulse + `sonic_evidence` sections cleanly with zero sample markers and zero sample callout boxes.
  - Overlapping sample clips (`sample_details` occasionally has adjacent or slightly overlapping clips): Render slim staggered tracks/lanes or highlight the closest active clip card and allow clicking individual clip pills below if multiple clips exist.
  - `YouTubeEmbed.jsx` seek integration (optional future polish): Currently `YouTubeEmbed.jsx` uses a standard `<iframe>` without `enablejsapi=1`. You can build the visualizer standalone first, and optionally add a `"Seek video"` / YT IFrame `postMessage` hook later if desired.
