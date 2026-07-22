# Filter sidebar + analysis presentation — uniform sections, real tooltips, two-up layout

_Design spec. 2026-07-22. Curator-approved at brainstorm._
_Follow-up to [`2026-07-22-triage-1a-1b-analysis-tiers-and-scalar-filters-design.md`](./2026-07-22-triage-1a-1b-analysis-tiers-and-scalar-filters-design.md),
from the curator's smoke of that branch._

## Goal

Make the browse sidebar one consistent thing instead of five differently-built things, give every
filter group a plain-language description, replace the sluggish native tooltips with real ones, and
stop the song page running so far down.

## Sequencing (decided at brainstorm)

**This is built on a fresh branch off `main`, after both pending branches merge** —
`session-triage-4-browse-polish` first, then `session-triage-1a1b-analysis-tiers`. It touches
`SearchAndFilter.jsx`, which is already the file those two collide in; stacking a third change on it
would compound the conflict for no benefit. This spec is committed early (on the 1a+1b branch, as a
new file, so it conflicts with nothing) purely so the design isn't lost.

## Not in scope — one item from the smoke that needs no work

The curator reported the **sidebar's independent scroll** as broken. It is not a regression: that fix
is `max-height: calc(100vh - var(--space-4) * 2); overflow-y: auto` on `.browse-sidebar`, and it
lives only on `session-triage-4-browse-polish`. It returns when that branch merges. **Do not add it
here** — an independent copy would conflict with triage 4 in exactly that rule.

## 1. One shared `FilterSection` primitive

Today each sidebar section builds its own header: `GenreFilterTree` and `ThemeFacetTree` each render
an `<h3 className="filter-title">`, four sections in `SearchAndFilter` are inline
`<div className="filter-section">` blocks with a bare `<h3>`, and `ScalarFacetGroups` carries its own
collapse state and toggle button. Only the last collapses — which is exactly what the curator saw.

One component replaces all of them:

```jsx
<FilterSection title="Perspective" count={2} description="…" defaultOpen={false}>
  {children}
</FilterSection>
```

- Header is a `<button>` with `aria-expanded`, left-aligned (a button defaults to centred text — the
  bug the B3 theme tree shipped once), a `+`/`−` affordance, and the selected-count badge when > 0.
- `description` renders as a `.filter-note` **inside the body**, so it appears on expand — the
  curator's "a short description of them upon opening".
- Open/closed state is local to the component, keyed by nothing — each instance owns its own, and
  nesting is just a `FilterSection` inside another one's children.
- `ScalarFacetGroups` loses its bespoke toggle and becomes a thin map over `FilterSection`.

## 2. Sidebar structure

Every top-level section collapsible and uniform:

| Section | Body | Default |
|---|---|---|
| Genre & style | the existing genre tree | **open** |
| Themes & advocacy | 5 nested dimension sections | collapsed |
| Lyric metadata | 7 nested component sections | collapsed |
| Year range | the two year inputs | collapsed |
| Song length | 3 checkboxes | collapsed |
| Available on | 2 checkboxes | collapsed |
| Analysis | the has-analysis checkbox | collapsed |
| Language | language checkboxes | collapsed |

The five theme dimensions become the same visual unit as the seven metadata components — the
curator's "each component under Themes & Advocacy breaks out similar to the metadata components".
Grouping the seven under a **Lyric metadata** umbrella keeps the top level symmetric with Themes &
advocacy; the alternative (twelve flat sections) reads as a wall.

Only Genre & style is open on first load. Everything else is one click away and the sidebar starts
compact.

The existing coded-count note ("Only songs with lyrics analysis (617) are counted here…") stays on
the **Themes & advocacy** section as its description.

**What does not change inside those sections:** the genre tree's parent/subgenre behaviour and search
box, and the theme tree's sub-dimension → group → code hierarchy with its ancestor-select semantics,
are untouched. Only the *headers* become `FilterSection`s — in the theme tree's case its five
per-dimension `facet-dim-header` buttons are replaced by nested `FilterSection`s so they gain
descriptions and match the metadata components. The selection logic, counts and AND-of-terms
behaviour are presentation-independent and stay exactly as they are.

## 3. Description text — where it comes from

**Seven metadata components:** the codebook already carries a one-line `description` per component.
`analysis.scalarFacets` adds it to each component's payload; no new copy is written.

**Five theme dimensions:** no description exists anywhere — `taxonomy.json`'s `hierarchy.<dim>` has
only `label` and `sub_dimensions`. Curator chose "I draft, you approve". Once the wording below is
approved it is written into `taxonomy.json` as `hierarchy.<dim>.description` (keeping all vocabulary
in the curator's own artifact) and `analysis.facetTree` serves it alongside `label`.

**Drafts for curator edit** — each written from the sub-dimensions the dimension actually contains:

| Dimension | Draft description |
|---|---|
| **Core Sentiments & Themes** | What the song is about at its core — the harm it describes, the indifference it names, and the hope or defiance it reaches for. |
| **Targets & Species** | Who or what the song is about: particular animals, the industries that use them, and the systems and roles that keep it running. |
| **Actions & Advocacy** | What the song calls for or depicts being done — from direct intervention and rescue to public advocacy and personal practice. |
| **Tactics & Protest Methods** | How that action is carried out: confrontation and rescue, protest and organising, cultural critique and consumer pressure. |
| **Moral Frames & Ethical Justifications** | The moral reasoning the song argues from — rights and justice, compassion and duty, systemic critique, or environmental stewardship. |

## 4. `InfoTip` — a tooltip that appears when you hover

The delay the curator hit is the browser's: the native `title` attribute waits roughly a second, and
is neither stylable nor hurryable. A small component replaces it:

- Shows after **~120ms** on pointer hover, and immediately on keyboard focus.
- Dismisses on pointer-leave, blur, or Escape.
- A token-styled bubble (`--bg-surface-raised`, `--border-hairline`, `--text-*`), `max-width` ~28rem,
  positioned above the trigger and flipping below when there isn't room.
- The trigger is either an existing element (wrap-only mode) or a small **"i" icon button** with an
  `aria-label`.

Applied as:

| Surface | Trigger | Text |
|---|---|---|
| Song page — attribute value | the value itself (replaces native `title`) | that code's codebook definition |
| Song page — theme chip | the chip itself (replaces native `title`) | that code's taxonomy definition |
| Song page — the 7 component labels | **"i" icon** | the component's codebook description |
| Song page — the 5 dimension headings | **"i" icon** | the dimension description from §3 |
| Sidebar | — | none; the sidebar uses inline descriptions, not tooltips |

The "i" icon appears on headings only. One per chip would be visual noise, so chips stay
hover-anywhere.

## 5. Song page layout

**Emotions on one line.** `.la-attributes` is a `repeat(auto-fit, minmax(160px, 1fr))` grid and
emotions is one cell in it, so three emotions wrap inside a narrow column. The emotions row gets
`grid-column: 1 / -1` (full width) and its values join with **`; `** instead of `, `.

**Five dimension blocks two-up.** `.lyrical-analysis` is a single column flex; the five
`.la-dimension` blocks become a two-column grid (`repeat(2, minmax(0, 1fr))`) that collapses to one
column below **700px**. The attributes card and the evidence block stay full width — only the
dimension blocks pair up.

## Verification

No frontend test runner exists (consistent with Phase 3 / B2 / B3 / this session), so:

1. `npm run lint` + `npm run build` clean.
2. Backend `npm test` green — §3 touches `scalarFacets` and `facetTree` payloads, both under test.
3. Live smoke: every sidebar section expands and collapses; each shows its description on expand;
   the seven components and five dimensions read as sibling units; selected-count badges appear on
   collapsed sections. Song page: hovering an attribute value or chip shows a tooltip in well under
   a second; the "i" icons show component/dimension descriptions; emotions render on one line
   separated by `;`; the five dimension blocks sit two-up on desktop and stack on mobile.
4. Keyboard pass: every section header and every "i" icon reachable by Tab, operable by Enter/Space,
   tooltips dismissible with Escape.

## Out of scope

- The sidebar independent scroll (see above — it belongs to triage 4).
- Any change to filter semantics, counts, or the URL state — this is presentation only.
- `ArtistSearchAndFilter.jsx`, which still has its own hardcoded genre hierarchy (deferred since B3).
