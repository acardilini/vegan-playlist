# Triage item 5 — lyric highlights from the translation + multi-language `songs.language`

_Design spec. 2026-07-23. Curator-approved at brainstorm (four decisions recorded below)._
_Backlog: [`CURATOR_TRIAGE_BACKLOG.md`](../../CURATOR_TRIAGE_BACKLOG.md) §"Admin song dashboard"._

## Goal

Two curator requests from the 2026-07-20 triage, built together because they meet on the same
songs — the non-English ones:

1. **Add a key-lyrics highlight from the English translation**, not just from the original lyrics.
2. **Record more than one language per song** (bilingual songs), and let browse filter on each.

## Problem / current behaviour

- **Highlights come only from the lyrics box.** `LyricsPanel.addHighlight`
  (`frontend/src/components/admin/LyricsPanel.jsx:41-53`) reads the selection out of a single
  hardwired `lyricsRef`. The translation field right below it (`AutoText`, line 96) has no picker,
  so a translated line can only be added by copying it into the lyrics box — which would corrupt
  the lyrics.
- **`songs.language` is single-valued free text.** `VARCHAR(40)`, added by migration 006
  (`006_curation_workbench.sql:18`). A bilingual song can hold only one of its languages.
- **Language never appears on the public song page.** It exists solely as a browse filter, so a
  reader has no way to know a song is sung in Portuguese.

### Data as it stands (read-only check, 2026-07-23)

| | |
|---|---|
| Songs with any `language` | **38** of 1,800 — 35 `English`, 1 `German`, 1 `Mouri`, 1 `Portuguese` |
| Live (`included`+`published`) non-English songs | **3** — ids 4691 (Portuguese), 4692 (German), 4693 (Mouri) |
| Songs with a non-empty `song_lyrics.translation` | **2** (ids 4691, 4692) |
| Songs with `lyrics_highlights` | 47 |

This is greenfield curation, not a backlog to migrate: converting the column is cheap now and gets
steadily more expensive. `'Mouri'` is a typo for **`'Māori'`** and is corrected by the migration.

## Decisions (curator, at brainstorm)

1. **Highlights stay a flat list** — a translation selection is appended to the same
   newline-joined `songs.lyrics_highlights` blob, with no pairing and no per-line tagging. The
   curator controls the mix by adding an original line and then its translation. **No schema
   change** for this half.
2. **`songs.language` migrates to `TEXT[]`** (rejected: a semicolon-separated `TEXT` split at query
   time — parsing would live in every consumer and a separator typo would silently mint a phantom
   language).
3. **The workbench control becomes chips + suggestions** — removable chips, a free-text add input,
   and a one-click row of languages already used in the catalogue (rejected: free text alone, which
   converges on nothing; and a fixed dropdown, which needs a code edit per new language).
4. **The song page shows the language(s)** as a hero stat cell, and the Key-lyrics note gains a
   translation variant for non-English songs.

## Design

### 1. Highlights from the translation (frontend only, no schema change)

`LyricsPanel` gets a second ref and one generalised handler:

```jsx
const lyricsRef = useRef(null);
const translationRef = useRef(null);
const hasTranslation = !!(wb.translation && wb.translation.trim());

const addHighlightFrom = async (ref, sourceLabel) => {
  const el = ref.current;
  if (!el) return;
  const raw = el.value.substring(el.selectionStart, el.selectionEnd).trim();
  const sel = raw.replace(/\s*\n\s*/g, ' ');   // unchanged: keep a couplet one entry
  if (!sel) { window.alert(`Select a passage in the ${sourceLabel} box first.`); return; }
  setHighlightsSave('saving');
  const res = await savePanel('highlights', { lyrics_highlights: [...highlights, sel].join('\n') });
  setHighlightsSave(res.ok ? 'saved' : 'error');
};
```

The existing lyrics button calls `addHighlightFrom(lyricsRef, 'lyrics')`. The translation `AutoText`
gains `inputRef={translationRef}` (the prop already exists — `SavedField.jsx:10,37`) and a
**"+ Add selection"** button beside its label, calling `addHighlightFrom(translationRef,
'translation')`. That button is **disabled when the translation field itself is disabled**
(`!hasLyrics` — the existing guard against the backend's silent no-op) **or when the saved
translation is empty** (`!hasTranslation`).

Storage, `saveHighlights`, and the public render are untouched. The existing empty-state hint
("Select a line in the lyrics box above…") is extended to mention the translation box.

**Accepted trade-off, stated explicitly:** `songs.lyrics_highlights` **is** served by the public
song route, so this publishes short fragments of the curator's translation. This is the same trade
already made for analysis evidence quotes — brief excerpts public, the full `song_lyrics` row
local-only — and does not weaken the copyright guardrail (no public route gains access to
`song_lyrics`).

### 2. Migration 009 — `songs.language` → `TEXT[]`

`backend/database/migrations/009_multi_language.sql`, idempotent so a re-run is a no-op:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'songs' AND column_name = 'language'
               AND data_type <> 'ARRAY') THEN
    ALTER TABLE songs ALTER COLUMN language TYPE text[]
      USING CASE WHEN btrim(COALESCE(language, '')) = '' THEN NULL
                 ELSE regexp_split_to_array(btrim(language), '\s*;\s*') END;
    UPDATE songs SET language = NULLIF(array_remove(language, ''), '{}')
      WHERE language IS NOT NULL;
  END IF;
END $$;

-- Data fix: 'Mouri' is a typo for 'Māori' (1 row). Idempotent on its own.
UPDATE songs SET language = array_replace(language, 'Mouri', 'Māori')
  WHERE language IS NOT NULL AND 'Mouri' = ANY(language);
```

`regexp_split_to_array` is used rather than `string_to_array` because it trims whitespace **around**
the separator in one pass, and because `ALTER … USING` forbids subqueries (so a per-element
`array_agg(btrim(x))` is not available there). Splitting on `;` is future-proofing only — no stored
value contains one today.

`database/schema.sql` does **not** declare `language` (the column arrives in migration 006), so
there is no schema-file drift to fix.

### 3. Backend consumers

Every site that touches the column, verified by grep:

| File | Now | Becomes |
|---|---|---|
| `services/browseFilters.js:43-44` | `s.language = ANY($n::text[])` | `s.language && $n::text[]` (array overlap) |
| `routes/spotify.js:390-395` (`/filter-options`) | `SELECT language … GROUP BY language` | `FROM songs s, unnest(s.language) AS lang … GROUP BY lang` |
| `routes/spotify.js:467-469` (`/browse-facets`) | `SELECT s.language … GROUP BY s.language` | adds `CROSS JOIN LATERAL unnest(s.language) AS lang` after the existing joins; `GROUP BY lang` |
| `routes/spotify.js:208-253` (`/songs/:id`) | does not select `language` | add `s.language` to the SELECT **and to the GROUP BY** (the query aggregates artists) |
| `services/curation.js:231-238` (`saveDetails`) | writes the raw value | normalises an array (below) |

`unnest` in the `FROM` list drops rows whose array is `NULL` or empty, so the existing
`AND s.language IS NOT NULL AND s.language <> ''` guards are removed as redundant. A bilingual song
therefore contributes a count to **each** of its languages, and `&&` makes ticking either language
find it — facet and filter stay in agreement, which is the invariant B3 established.

`saveDetails` normalisation (trim, drop empties, dedupe, preserve order; empty → `NULL`):

```js
function normLanguages(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const arr = Array.isArray(v) ? v : String(v).split(';');
  const out = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
  return out.length ? out : null;
}
```

fed through the existing `add('language', normLanguages(language))`. The string branch keeps any
non-array caller (or a hand-rolled API call) working. `getWorkbench` and the queue row
(`curation.js:95,111,204`) return the array unchanged.

**New read-only endpoint** for the suggestion row — `GET /api/admin/languages`, in the Artists /
data-quality neighbourhood of `routes/admin.js`, behind the existing admin password middleware:

```sql
SELECT lang AS value, COUNT(*)::int AS count
FROM songs s, unnest(s.language) AS lang
GROUP BY lang ORDER BY count DESC, value ASC
```

It covers **all** songs regardless of status — the public `/filter-options` sees only published
ones, and the curator edits unpublished songs.

### 4. Workbench chip editor

`DetailsPanel.jsx` replaces the `AutoText` language field with a local `LanguageChips` component
(single consumer → stays in the file, per the project's convention):

- Current languages render as removable chips (`Portuguese ×`).
- An add input commits on **Enter** (and on blur if non-empty); duplicates and blanks are ignored.
- A suggestion row of catalogue languages **not already on this song** adds with one click,
  fetched once on mount via `adminFetch('/api/admin/languages')` and refetched after a save so a
  newly typed language becomes a suggestion for the next song.
- Every mutation calls `savePanel('details', { language: nextArray })` and reports through the
  existing `SaveTag`, awaiting the result — the save-failure-feedback standard set in A3.
- The old **"Set English"** button disappears: `English` is the first suggestion, being the most
  used value.

Styling reuses the existing chip/`btn-sm` classes in `admin.css`; no new tokens.

### 5. Song page

`SongDetailPage.jsx` — a third hero stat cell, rendered only when the song has languages:

```jsx
{song.language?.length > 0 && (
  <div className="stat-cell">
    <span className="stat-cell-label">Sung in</span>
    <span className="stat-cell-value">{song.language.join(', ')}</span>
  </div>
)}
```

and the Key-lyrics note picks a variant:

```jsx
const nonEnglish = (song.language || []).some((l) => l.trim().toLowerCase() !== 'english');
…
<span className="section-note">
  {nonEnglish
    ? 'Brief excerpts, with English translation, for analytical purposes'
    : 'Brief excerpts for analytical purposes'}
</span>
```

**Known imprecision, accepted by the curator:** the public payload cannot distinguish an
original-language highlight from a translated one, so on a non-English song the note asserts a
translation is present even if only original lines were added. The alternative ("…with English
translation where available…") was offered and not taken.

**`SearchAndFilter.jsx` needs no change** — it already consumes `{value, count}` facet rows and
already sends `languages` as an array. Verified against `SearchAndFilter.jsx:381-392` and
`browseUrlState.js:16,25`.

## Testing

**Backend (`node:test`, existing suites).** Three existing tests use the column as a *scalar* and
**must be converted, not deleted**:

- `test/analysis.test.js:274` and `:345` — constraint clauses `s.language = $n` → `s.language && $n::text[]`
  with an array param.
- `test/analysis.test.js:265,343` — the `INSERT`/`UPDATE` fixtures write `'ZZZ-NoSuchLang'` → `ARRAY['ZZZ-NoSuchLang']`.
- `test/curation.test.js:213,217,232-236` — `SET language='Spanish'` and the `saveDetails` assertions
  become array-valued (`ZZZCUR` fixture prefix retained; one prefix per file).
- `test/browseFilters.test.js:43-44` — asserts the new `&&` clause and its parameter position.

New coverage:

- `test/migration009.test.js` — `information_schema` reports `data_type = 'ARRAY'` for
  `songs.language`, and no row still contains `'Mouri'`.
- `saveDetails` normalisation: `['  German ', 'German', '']` → `{German}`; `[]` and `''` → `NULL`;
  a plain string `'German; English'` → `{German,English}`.
- A facet test asserting a two-language song counts under **both** languages and is returned when
  filtering by **either**.

**Live smoke** (the flows a curator would run):

1. Workbench on song 4691 (Portuguese, has a translation and highlights): add a second language via
   chips, remove it, add one from the suggestion row; select a line in the **translation** box and
   "+ Add selection"; confirm it lands in Key lyrics and survives a reload.
2. Browse sidebar: the Language section lists Portuguese/German/Māori/English with counts; ticking
   Portuguese returns 4691; a bilingual song appears under both of its languages.
3. Song page 4691: the "Sung in" hero cell and the translation-variant note; an English song shows
   the plain note; a song with no language recorded shows no cell.

## Out of scope (YAGNI)

- Pairing or tagging highlights by source (decision 1 — flat list).
- A canonical language vocabulary, ISO codes, or a `languages` table.
- Language on `SongCard`, the artist page, or anywhere else public beyond the song-page hero.
- Backfilling `language` for the other 1,762 songs — that is curation, not code.
