# B4 map refinements, Batch A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the curator's B4 smoke §4 findings on the Explore map — name every genre in the legend and make each one spotlightable, enlarge the dots, quieten the coverage line, and say what each space means — so the B4 branch can merge.

**Architecture:** All four changes are read-only presentation. `backend/services/explore.js` stops folding
a song's genre into a bucket and instead serves the **raw parent genre** per song plus a **nested legend**
whose "Other genres" entry carries its members as `children`. The frontend's `colourScale` reads that
nesting so a child inherits its group's colour — which is what keeps every dot's colour explained by a
visible legend entry while the palette stays at its validated four slots. Nothing writes to any table.

**Tech Stack:** Node/Express + `pg` (backend, `node:test`), React 19 + Vite + react-router v7 (frontend),
plain CSS custom properties in `frontend/src/styles/components.css`.

## Global Constraints

- **`services/explore.js` is read-only.** No `INSERT`/`UPDATE`/`DELETE` in any task.
- **Public reads always filter `status='included' AND published=true`.** Do not touch `mapRows`' WHERE.
- **The palette stays at four validated categorical slots.** `VALIDATED_CATS` remains `4`.
  Do not add `--explore-cat-6` or beyond. The 5-, 6- and 8-colour sets were measured and FAIL the
  `dataviz` all-pairs gate (see the spec's table); this is settled, not a preference.
- **`--explore-not-coded` grey means "no genre at all" and nothing else.** The small-genre group takes
  categorical slot 4, never the neutral.
- **Every backend test file uses its own fixture sentinel.** `explore.test.js` uses `ZZZEXP` — keep it.
- **Commit messages** end with the two trailers used throughout this repo:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and the `Claude-Session:` line.
  Write long messages via `git commit -F <file>`; PowerShell here-strings mangle them.
- **Run git and npm from the repo root or the named subdirectory** — `cd` inside a compound PowerShell
  command triggers a permission prompt.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/services/explore.js` | Raw genre codes per song; nested genre legend; per-space descriptions | 1, 3 |
| `backend/test/explore.test.js` | Coverage for both | 1, 3 |
| `frontend/src/components/explore/palette.js` | Children inherit the group's colour | 2 |
| `frontend/src/components/explore/ExploreMap.jsx` | Nested legend render; group spotlight; description line; dot radius | 2, 3, 4 |
| `frontend/src/styles/components.css` | Nested legend styles; quieter coverage line; description line | 2, 3, 4 |

---

### Task 1: Backend — raw genre codes and a nested genre legend

**Files:**
- Modify: `backend/services/explore.js` (constants ~line 87–94, `genreFold` ~139–156, `legendFor`
  ~162–192, `mapPayload` ~197–221, exports ~372)
- Test: `backend/test/explore.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `explore.genreTopSet(rows) -> Set<string>` — the parent genres that get their own colour slot.
  - Legend entries gain an optional `children` array: `{ code, label, count, children?: [{code,label,count}] }`.
  - `song.codes.genre` is now the **raw** parent genre (e.g. `'folk'`), never `'OTHER_GENRES'`.
  - `explore.OTHER_GENRES` / `explore.OTHER_GENRES_LABEL` keep their current values.

- [ ] **Step 1: Write the failing tests**

Replace the whole `genreFold` test (currently `backend/test/explore.test.js:137–169`) with these two:

```js
test('genreTopSet picks the top-N named parents and never the literal other', () => {
  // Synthetic rows, independent of the live catalogue: metal(4) > hardcore(3) > punk(2) >
  // folk(1). 'christian' maps to the literal 'other' parent and is given the highest count
  // of all, to prove it is excluded from the ranking regardless of count.
  const rows = [
    ...Array(4).fill({ genre: 'metalcore' }),  // -> metal
    ...Array(3).fill({ genre: 'hardcore' }),   // -> hardcore
    ...Array(2).fill({ genre: 'punk' }),       // -> punk
    { genre: 'folk' },                         // -> folk (outside the top 3)
    ...Array(5).fill({ genre: 'christian' }),  // -> other (literal parent, never ranked)
    { genre: null },                           // -> NOT_CODED
  ];
  const top = explore.genreTopSet(rows);

  assert.ok(top.has('metal'));
  assert.ok(top.has('hardcore'));
  assert.ok(top.has('punk'));
  assert.ok(!top.has('folk'), 'a genre outside the top 3 gets no colour slot');
  assert.ok(!top.has('other'), 'the literal other parent is never ranked, whatever its count');
  assert.ok(!top.has(explore.NOT_CODED));
  assert.equal(top.size, 3);
});

test('the genre legend names every genre, nesting the small ones under Other genres', () => {
  const rows = [
    ...Array(4).fill({ genre: 'metalcore' }),
    ...Array(3).fill({ genre: 'hardcore' }),
    ...Array(2).fill({ genre: 'punk' }),
    { genre: 'folk' },
    ...Array(5).fill({ genre: 'christian' }),  // -> other
    { genre: null },
  ];
  const codes = explore.legendFor(
    { key: 'genre', label: 'Genre', source: 'genre' }, rows, explore.genreTopSet(rows));

  // Top 3 are their own entries, in count order, with no children.
  assert.deepEqual(codes.slice(0, 3).map(c => c.code), ['metal', 'hardcore', 'punk']);
  assert.equal(codes[0].count, 4);
  assert.ok(!codes[0].children, 'a top-3 genre is a leaf');

  // Then the group, carrying its members. Its count is the sum of theirs.
  const group = codes.find(c => c.code === explore.OTHER_GENRES);
  assert.ok(group, 'the Other genres group exists');
  assert.equal(group.label, 'Other genres');
  assert.equal(group.count, 6, 'folk(1) + other(5)');
  assert.deepEqual(group.children.map(c => c.code), ['other', 'folk'],
    'members sort by descending count');
  assert.equal(group.children[0].label, 'Unclassified genre',
    'the literal other parent is NOT labelled "Other" inside a group called "Other genres"');
  assert.equal(group.children[1].label, 'Folk');

  // Not coded stays its own last entry and is never swept into the group.
  const last = codes[codes.length - 1];
  assert.equal(last.code, explore.NOT_CODED);
  assert.equal(last.count, 1);
  assert.ok(!group.children.some(c => c.code === explore.NOT_CODED));
});
```

Then add this test, which pins the per-song change:

```js
test('a song carries its raw parent genre, so a small genre can be spotlit by name', async () => {
  const folkId = await mkSong('ZZZEXP Folk', { genre: 'folk' });
  await addCoords(folkId);

  const p = await explore.mapPayload(pool);
  const song = p.songs.find(s => s.id === folkId);

  assert.equal(song.codes.genre, 'folk',
    'raw parent genre, not OTHER_GENRES — the spotlight targets this value');

  // And that raw code is reachable in the legend: either as its own entry or as a
  // named child of the group. This is the invariant — a dot is always explained.
  const genre = p.colourBy.find(c => c.key === 'genre');
  const flat = genre.codes.flatMap(c => [c, ...(c.children || [])]);
  assert.ok(flat.some(c => c.code === 'folk'), 'every raw code appears in its own legend');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
cd backend
npm test
```

Expected: FAIL — `explore.genreTopSet is not a function`, and the mapPayload test fails with
`song.codes.genre === 'OTHER_GENRES'`.

- [ ] **Step 3: Replace `genreFold` with `genreTopSet`**

In `backend/services/explore.js`, replace the `genreFold` function and its comment block with:

```js
// The parent genres that get their own colour slot: the top N by count, excluding NOT_CODED
// and the literal 'other' parent (which already means "unclassified", so it never competes
// for a named slot). Every OTHER genre still appears in the legend by name — as a child of
// the "Other genres" group — because the palette caps how many colours can coexist, not how
// many genres a reader may see. Four simultaneous categorical colours is a measured hard
// ceiling at scatter rigor; see the 2026-08-02 spec.
function genreTopSet(rows) {
  const counts = new Map();
  for (const r of rows) {
    const code = codeFor('genre', r);
    if (code === NOT_CODED || code === 'other') continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, GENRE_TOP_N)
      .map(([code]) => code));
}
```

Update the `GENRE_TOP_N` comment above it (currently at ~line 87) to:

```js
// Genre carries more parent values than the palette has colour slots — 11 on the live map
// against 4 validated categorical slots. GENRE_TOP_N sets how many genres get their OWN
// colour; the rest share slot 4 as one "Other genres" group but are still listed and still
// individually spotlightable. It does not control how many genres the reader can see.
const GENRE_TOP_N = 3;
```

- [ ] **Step 4: Teach `legendFor` to nest**

Replace `legendFor`'s signature and genre handling. The non-genre path is unchanged apart from
dropping the fold:

```js
function legendFor(dim, rows, top) {
  const counts = new Map();
  for (const r of rows) {
    const code = codeFor(dim.key, r);
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const ordered = [];
  const seen = new Set([NOT_CODED]);
  const known = dim.source === 'acoustic' ? acoustic.optionsFor(dim.key)
    : dim.source === 'scalar' ? codebook.optionsFor(dim.key)
    : [];
  for (const o of known) {
    seen.add(o.code);
    if (counts.has(o.code)) ordered.push({ code: o.code, label: o.label, count: counts.get(o.code) });
  }

  if (dim.source === 'genre') {
    // Top-N first, in count order, each its own coloured entry.
    const ranked = [...counts.entries()]
      .filter(([code]) => code !== NOT_CODED)
      .sort((a, b) => b[1] - a[1]);
    for (const [code, count] of ranked.filter(([code]) => top.has(code))) {
      ordered.push({ code, label: labelFor(dim, code), count });
    }
    // Everything else becomes one group that SHARES a colour but names its members, so a
    // 1-song genre is still visible and still clickable.
    const rest = ranked.filter(([code]) => !top.has(code));
    if (rest.length) {
      ordered.push({
        code: OTHER_GENRES,
        label: OTHER_GENRES_LABEL,
        count: rest.reduce((n, [, c]) => n + c, 0),
        children: rest.map(([code, count]) => ({ code, label: labelFor(dim, code), count })),
      });
    }
  } else {
    const extras = [...counts.entries()]
      .filter(([code]) => !seen.has(code))
      .sort((a, b) => b[1] - a[1]);
    for (const [code, count] of extras) {
      ordered.push({ code, label: labelFor(dim, code), count });
    }
  }

  if (counts.has(NOT_CODED)) {
    ordered.push({ code: NOT_CODED, label: NOT_CODED_LABEL, count: counts.get(NOT_CODED) });
  }
  return ordered;
}
```

- [ ] **Step 5: Stop labelling the literal `other` parent "Other"**

In `labelFor`, the literal `other` parent would render as "Other" — indefensible as a child of a
group called "Other genres". Add the case immediately after the `OTHER_GENRES` line:

```js
function labelFor(dim, code) {
  if (code === NOT_CODED) return NOT_CODED_LABEL;
  if (code === OTHER_GENRES) return OTHER_GENRES_LABEL;
  // getParentGenre returns the literal 'other' for a genre string it does not recognise —
  // the song HAS a genre, it just is not one we map. That is a different claim from
  // "Not coded", and naming it "Other" inside "Other genres" would blur both.
  if (dim.source === 'genre' && code === 'other') return 'Unclassified genre';
  if (dim.source === 'acoustic') return acoustic.codeLabel(dim.key, code);
  if (dim.source === 'scalar') return codebook.codeLabel(dim.key, code);
  return titleCase(code);
}
```

- [ ] **Step 6: Serve raw codes from `mapPayload`**

In `mapPayload`, replace the `fold` computation and both its uses:

```js
  // Computed once and shared with legendFor below: the legend and the colour assignment must
  // agree on which genres own a slot, or a dot could take a colour its legend never explains.
  const top = genreTopSet(rows);

  const songs = rows.map(r => {
    const coords = {};
    for (const s of spaces) coords[s.key] = r[s.column];
    const codes = {};
    // Raw codes, deliberately unfolded: the spotlight targets an exact genre, and the
    // frontend derives a dot's COLOUR from the legend's nesting instead.
    for (const d of COLOUR_DIMENSIONS) codes[d.key] = codeFor(d.key, r);
    return {
      id: r.id,
      title: r.title,
      artist: (r.artists || []).join(', '),
      year: r.year,
      art: r.art,
      coords,
      codes,
    };
  });
```

Find the `colourBy` block further down in the same function and change its `legendFor` call to pass
`top` instead of `fold`.

- [ ] **Step 7: Update the exports**

At the bottom of `backend/services/explore.js`, replace `genreFold` with `genreTopSet` in the exported
object. Leave `OTHER_GENRES`, `OTHER_GENRES_LABEL`, `NOT_CODED`, `codeFor` and `legendFor` exported.

- [ ] **Step 8: Run the tests**

```
cd backend
npm test
```

Expected: PASS, **164** tests (162 before, minus the removed `genreFold` test, plus three new).
Task 3 adds the 165th.
If the existing test at `explore.test.js:171` ("genre colour-by via mapPayload…") fails because it
asserts the legend fits the palette, update it to flatten `children` the way the new test does —
its intent (every song's code appears in its own legend) is unchanged and still correct.

- [ ] **Step 9: Commit**

```bash
git add backend/services/explore.js backend/test/explore.test.js
git commit -F <message file>
```

Message subject: `feat(explore): name every genre in the legend, nesting the small ones`

---

### Task 2: Frontend — inherit the group's colour, render the nested legend

**Files:**
- Modify: `frontend/src/components/explore/palette.js` (`colourScale`, ~line 33)
- Modify: `frontend/src/components/explore/ExploreMap.jsx` (`scale` memo ~line 79; legend render ~264–284)
- Modify: `frontend/src/styles/components.css` (`.explore-legend` block, ~line 2540)

**Interfaces:**
- Consumes: legend entries from Task 1, shape `{ code, label, count, children?: [{code,label,count}] }`;
  `song.codes.genre` is a raw parent genre.
- Produces: `colourScale(entries, dimensionLabel)` — **note the signature change**, it now takes the
  legend entry objects, not a `string[]` of codes.

- [ ] **Step 1: Make children inherit their group's colour**

In `frontend/src/components/explore/palette.js`, replace `colourScale` with:

```js
// Colour lookup for one legend. Entries arrive in legend order; NOT_CODED always takes the
// neutral, never a categorical slot. A group's `children` share the group's colour — that is
// what lets the legend name 11 genres while the palette stays at its 4 validated slots, and
// it keeps the invariant that every dot's colour is explained by a legend entry on screen.
// `dimensionLabel` is optional and used only to name the dimension in the overflow warning.
export function colourScale(entries, dimensionLabel) {
  const cats = CAT_VARS.map(v => cssVar(v, '#888'));
  const neutral = cssVar('--explore-not-coded', '#8a8a8a');
  const map = new Map();
  let i = 0;
  for (const entry of entries) {
    if (entry.code === NOT_CODED) { map.set(entry.code, neutral); continue; }
    if (i >= VALIDATED_CATS) {
      // Silent-and-visual is the worst failure mode here: a wrong colour looks plausible,
      // not broken. Loud in the console instead — names the dimension and the code so the
      // next person sees it the first time it happens, rather than discovering it by eye.
      console.warn(
        `explore palette: "${dimensionLabel || 'this dimension'}" needs a ${i + 1}th `
        + `categorical colour ("${entry.code}"), past the ${VALIDATED_CATS} validated slots. `
        + 'Group the surplus codes server-side under one parent entry with `children` '
        + "(see genre's Other genres group in backend/services/explore.js) rather than "
        + 'relying on this colour.');
    }
    const colour = cats[i % cats.length];
    map.set(entry.code, colour);
    for (const child of entry.children || []) map.set(child.code, colour);
    i += 1;
  }
  return (code) => map.get(code) || neutral;
}
```

- [ ] **Step 2: Pass entries, not codes**

In `frontend/src/components/explore/ExploreMap.jsx`, change the `scale` memo:

```jsx
  const scale = useMemo(
    () => colourScale(legend ? legend.codes : [], legend && legend.label),
    [legend]);
```

- [ ] **Step 3: Add the group-aware spotlight helper**

Add above the `return (` in `ExploreMap.jsx`:

```jsx
  // A group toggles all of its members at once; a leaf toggles itself. Spotlight state holds
  // raw codes only, because that is what a song carries — the group is a legend construct.
  const codesOf = (entry) => (entry.children && entry.children.length
    ? entry.children.map(c => c.code)
    : [entry.code]);

  const toggleEntry = (entry) => {
    const codes = codesOf(entry);
    const next = new Set(spotlit);
    if (codes.every(c => next.has(c))) codes.forEach(c => next.delete(c));
    else codes.forEach(c => next.add(c));
    setParam('codes', [...next].join(','));
  };
```

- [ ] **Step 4: Render the nested legend**

Replace the `<ul className="explore-legend">…</ul>` block with:

```jsx
          <ul className="explore-legend">
            {legend && legend.codes.map(c => {
              const on = codesOf(c).every(code => spotlit.has(code));
              return (
                <li key={c.code}>
                  <button
                    type="button"
                    className={`explore-legend-toggle ${spotlit.size && !on ? 'off' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleEntry(c)}
                  >
                    <span className="explore-swatch" style={{ background: scale(c.code) }} />
                    {c.label} <span className="explore-legend-count">({c.count})</span>
                  </button>
                  {c.children && c.children.length > 0 && (
                    <ul className="explore-legend-children">
                      {c.children.map(ch => (
                        <li key={ch.code}>
                          <button
                            type="button"
                            className={`explore-legend-toggle ${spotlit.size && !spotlit.has(ch.code) ? 'off' : ''}`}
                            aria-pressed={spotlit.has(ch.code)}
                            onClick={() => toggleEntry(ch)}
                          >
                            {ch.label} <span className="explore-legend-count">({ch.count})</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
```

Note the children carry **no swatch** — they share the parent's colour, and repeating it eight times
would imply eight distinct colours that do not exist.

- [ ] **Step 5: Style the nesting**

In `frontend/src/styles/components.css`, immediately after the `.explore-legend li` rule, add:

```css
/* Members of a colour group: indented under their parent, no swatch of their own — they
   share the parent's colour, and eight repeated swatches would imply eight distinct
   colours the validated palette does not have. The hairline is the grouping cue. */
.explore-legend-children {
  list-style: none;
  margin: 0 0 var(--space-1);
  padding: 0 0 0 var(--space-3);
  border-left: 1px solid var(--border-hairline);
  margin-left: 5px;
}
.explore-legend-children li { display: flex; align-items: center; padding: 1px 0; }
.explore-legend-children .explore-legend-toggle { font-size: 0.85rem; color: var(--text-secondary); }
```

Also change `.explore-legend li` from `display: flex` to `display: block` so a parent `<li>` can
stack its button above its children list; add `.explore-legend > li > .explore-legend-toggle
{ display: flex; align-items: center; gap: var(--space-2); }` to preserve the swatch alignment.

- [ ] **Step 6: Verify in the browser**

```
cd frontend
npm run lint
npm run build
```

Expected: 0 errors (6 pre-existing warnings), build clean. Then load `/explore`, choose **Colour by →
Genre**, and confirm: every genre named; metal/hardcore/punk have their own swatches; "Other genres"
has a swatch and its members are indented without swatches (nine of them on today's data); clicking a
member dims everything else; clicking the group lights all of them; the counts still sum to 640.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/explore/palette.js frontend/src/components/explore/ExploreMap.jsx frontend/src/styles/components.css
git commit -F <message file>
```

Message subject: `feat(explore): nested genre legend with per-genre spotlight`

---

### Task 3: Per-space descriptions

**Files:**
- Modify: `backend/services/explore.js` (beside `SPACE_LABELS`, ~line 13; `discoverSpaces` ~34;
  `mapPayload`'s `spaces` mapping ~224)
- Modify: `frontend/src/components/explore/ExploreMap.jsx` (toolbar block)
- Modify: `frontend/src/styles/components.css`
- Test: `backend/test/explore.test.js`

**Interfaces:**
- Consumes: `discoverSpaces` from the current code; `spaces[]` in the payload from Task 1's `mapPayload`.
- Produces: each served space gains `description: string | null`.

- [ ] **Step 1: Write the failing test**

Add to `backend/test/explore.test.js`:

```js
test('each known space is served with a description, and an unknown one with null', async () => {
  const spaces = await explore.discoverSpaces(pool);
  const byKey = Object.fromEntries(spaces.map(s => [s.key, s]));

  assert.match(byKey.thematic.description, /lyrics/i);
  assert.match(byKey.audio.description, /acoustic/i);
  assert.match(byKey.holistic.description, /both/i);

  // Discovery is data-driven, so a space the pipeline adds later has no copy written for it.
  // It must serve null rather than an invented sentence.
  assert.equal(explore.spaceDescription('some_new_space'), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

```
cd backend
npm test
```

Expected: FAIL — `explore.spaceDescription is not a function`.

- [ ] **Step 3: Add the descriptions**

In `backend/services/explore.js`, directly below `SPACE_LABELS`:

```js
// What each projection was built from. Curator's wording, 2026-08-02 smoke — the three
// spaces do mean distinct things and the page should say so. Discovery is data-driven, so a
// space with no entry here serves null and the page simply shows no line, exactly as labels
// fall back to titleCase.
const SPACE_DESCRIPTIONS = {
  thematic: 'Positioned by an analysis of the lyrics.',
  audio: "Positioned by an analysis of the song's acoustic properties.",
  holistic: 'Positioned by an analysis of both the lyrics and the sound.',
};

function spaceDescription(key) {
  return SPACE_DESCRIPTIONS[key] || null;
}
```

In `discoverSpaces`, add the field to the mapped object:

```js
      return { key, column: c, label: spaceLabel(key), description: spaceDescription(key) };
```

In `mapPayload`'s return, widen the `spaces` projection:

```js
    spaces: spaces.map(s => ({ key: s.key, label: s.label, description: s.description })),
```

Add `spaceDescription` and `SPACE_DESCRIPTIONS` to the module exports.

- [ ] **Step 4: Run the tests**

```
cd backend
npm test
```

Expected: PASS. Note the existing `mapRows` test asserts `!('semantic_2d' in row)` — unaffected.

- [ ] **Step 5: Render the line**

In `ExploreMap.jsx`, add a `spaceMeta` lookup beside the existing `legend` memo:

```jsx
  const spaceMeta = useMemo(
    () => (data && data.spaces.find(s => s.key === space)) || null,
    [data, space]);
```

Then, immediately after the closing `</div>` of `.explore-toolbar` and before `<div className="explore-body">`:

```jsx
      {spaceMeta && spaceMeta.description && (
        <p className="explore-space-note">{spaceMeta.description}</p>
      )}
```

- [ ] **Step 6: Style it**

In `components.css`, beside `.explore-coverage`:

```css
/* One quiet line naming what the selected projection was built from. Requested directly in
   the 2026-08-02 smoke; it is deliberately the same weight as the coverage line so neither
   competes with the plot. */
.explore-space-note {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}
```

- [ ] **Step 7: Verify and commit**

```
cd frontend
npm run lint
npm run build
```

Expected: 0 errors, build clean. On `/explore`, the line changes as you click Thematic / Sound / Holistic.

```bash
git add backend/services/explore.js backend/test/explore.test.js frontend/src/components/explore/ExploreMap.jsx frontend/src/styles/components.css
git commit -F <message file>
```

Message subject: `feat(explore): say what each space was built from`

---

### Task 4: Dot size and a quieter coverage line

**Files:**
- Modify: `frontend/src/components/explore/ExploreMap.jsx:7`
- Modify: `frontend/src/styles/components.css` (`.explore-coverage`, ~line 2546)

**Interfaces:**
- Consumes: nothing. Produces: nothing. Purely visual; no test.

- [ ] **Step 1: Enlarge the dots**

In `ExploreMap.jsx`, change line 7:

```js
const DOT_RADIUS = 4;
```

- [ ] **Step 2: Quieten the coverage line**

In `components.css`, replace the `.explore-coverage` rule:

```css
/* An honest statement of what the map cannot show, not a headline. The curator confirmed the
   wording reads as a limit rather than a bug; only the weight needed dropping. */
.explore-coverage {
  margin-top: var(--space-3);
  color: var(--text-muted);
  font-size: 0.8rem;
}
```

- [ ] **Step 3: Verify**

```
cd frontend
npm run lint
npm run build
```

Expected: 0 errors, build clean. On `/explore`, dots read slightly heavier and the coverage line
recedes. **This is a judgement call the curator must confirm by eye** — it is the one change in this
plan no check can settle.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/explore/ExploreMap.jsx frontend/src/styles/components.css
git commit -F <message file>
```

Message subject: `feat(explore): larger dots and a quieter coverage line`

---

## Done when

- Backend suite green (expect **165**), lint 0 errors, frontend build clean.
- `/explore` → Colour by → Genre lists every genre, counts summing to 640, with the small
  ones nested under "Other genres" and each individually spotlightable.
- The space note changes with the selected chip; the coverage line is quieter; dots are larger.
- Curator confirms the dot size and the legend by eye — then the B4 branch is ready for its final
  whole-branch review, carrying the **17 Minor** findings from Tasks 1–6 of the original plan for triage.
