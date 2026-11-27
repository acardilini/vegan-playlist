# Artist Workbench Redesign, Slice 1 (Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-column artist workbench with a shell: header, "Needs you" banner, Details | Catalogue tabs, section 1 (Identity and links), a Merge dialog and a Mark-done footer, keeping the not-yet-rebuilt panels working underneath.

**Architecture:** `ArtistWorkbench` stays the route component and only loads the artist; a new `WorkbenchBody`, keyed on the artist id, owns the UI state (tab from the URL, the enrichment review through a new `useEnrichmentReview` hook, the merge dialog). The match step moves out of `EnrichmentPanel` into section 1; the rest of `EnrichmentPanel`, `ArtistDetailsPanel` and `ArtistFactsPanel` stay in a temporary stack until slices 2 and 3 replace them. Two tiny back-end changes feed the shell (a `wrong_identity` flag, and Mark done working without a staged proposal).

**Tech Stack:** React 19 + Vite, react-router, plain CSS tokens (`frontend/src/styles/admin.css`); Node/Express, PostgreSQL, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-27-artist-workbench-redesign-design.md` (sections 5.1, 5.2 part 1, 5.3, 5.5 last-but-one bullet, 5.6 slice 1). Mockups: `.superpowers/brainstorm/4808-1795772426/content/` (git-ignored; `structure.html`, `details-v2.html`, `merge-v1.html`).

## Global Constraints

- Follow `docs/ADMIN_UI.md`: lists are tables (`.adm-list`, `.adm-head`, `.adm-row`, `.adm-col-label`, `.adm-col-field`, `.adm-col-open`, `.adm-pill`, `.adm-x`, `.adm-actions`), body text `0.85rem`, pills `0.7rem`, `btn-sm`/`input-sm`, tokens only (`--space-*`, `--text-*`, `--bg-*`, `--border-hairline`, `--accent-ember-60`, `--color-danger`, `--accent-moss-60`); never raw colours.
- Option A invariant: nothing writes `artist_enrichment_proposals`; only `services/artistEnrichment.js` may name the proposals or review tables (test-enforced). Identity is written only by `bandCheck.saveIdentity`; artist columns only by `artists.update`; merge only by `artistMerge`.
- `artist_members.vegan` is curator-only. "Accept all shown" stays fill-only.
- Serious problems go in the banner and are never collapsed; lesser warnings stay on their own rows.
- Backend tests: one unique fixture sentinel per file (`ZZZENR` read, `ZZZENW` write; do not reuse another file's) and `npm test -- --test-concurrency=1`. Frontend tests are pure `*.test.js` run with `node --test $(find src -name "*.test.js")` from `frontend/`; there is no component test runner.
- Git: `git add` explicit paths only (never a bare `git add backend`; `backend/docs/` and `docs/examples/` stay untracked); commit with `git commit -F <file>` ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never `taskkill` all node; never type `ADMIN_PASSWORD` in a browser; PROJECT_STATE.md and CLAUDE.md are CRLF, so edit them with a script that preserves line endings.
- Branch `session-artist-workbench` from `main`; nothing merges before the curator says "Merge".

## Review Focus

Behaviours the spec implies but the tasks' unit tests cannot exercise (verified in the browser harness in Task 7):
1. **An artist with no staged proposal** (about 120): no banner, no match row, no enrichment rows, and Mark artist done still works and shows "Reviewed" after a reload.
2. **Prev / Next mid-save and stale responses:** the shell is keyed on the artist id, so a late response for the old artist is dropped, as today.
3. **`?mergeWith=` with a stale, self or non-numeric id:** self and junk are ignored; an id that no longer exists shows the dialog's error line, never a blank dialog.
4. **After a merge:** when this artist was the loser the page goes to the keeper; when it was the keeper the page re-reads (artist, review, facts) so no shared-id banner remains.
5. **The dialog:** Escape and the backdrop do not close it while a merge is running; Merge cannot be double-submitted; focus returns to the button that opened it.
6. **Accept all that auto-finishes** (nothing left over) updates the footer to "Reviewed" without a reload.

## File Structure

| File | Responsibility |
|---|---|
| `backend/services/artistEnrichment.js` (modify) | `getReview` adds `match.wrong_identity` and, with no proposal, returns `{has_proposal:false, finished_at}`; `finish` no longer needs a proposal |
| `frontend/src/utils/workbenchView.js` (create) + `.test.js` | pure: tab and `mergeWith` URL state, banner items, section-1 status |
| `frontend/src/components/admin/useEnrichmentReview.js` (create) | the review state and actions lifted out of `EnrichmentPanel` |
| `frontend/src/components/admin/MatchStep.jsx` (create) | the MusicBrainz match block (moved from `EnrichmentPanel`) |
| `frontend/src/components/admin/EnrichmentPanel.jsx` (modify) | rows, members, accept-all only; takes the hook result as a prop |
| `frontend/src/components/admin/MergeDialog.jsx` (create) | the merge flow as a modal (replaces `ArtistMergePanel.jsx`, deleted) |
| `frontend/src/components/admin/IdentifyPanel.jsx` (modify) | same logic, rendered as `.adm-list` rows |
| `frontend/src/components/admin/IdentitySection.jsx` (create) | section 1: link rows, match step, website row, "Merge with another artist..." |
| `frontend/src/components/admin/ArtistWorkbench.jsx` (rewrite) | loader + `WorkbenchBody` shell |
| `frontend/src/components/admin/ArtistDetailsPanel.jsx` (modify) | drop Name (moves to the header) |
| `frontend/src/components/admin/ArtistLinksPanel.jsx`, `ArtistMergePanel.jsx` (delete) | replaced |
| `frontend/src/styles/admin.css` (modify) | `.aw-*` classes for the shell |

---

### Task 1: Back end - `wrong_identity` flag and Mark done without a proposal

**Files:**
- Modify: `backend/services/artistEnrichment.js` (`getReview`, `finish`)
- Test: `backend/test/enrichmentRead.test.js` (sentinel `ZZZENR`), `backend/test/enrichmentWrite.test.js` (sentinel `ZZZENW`), `backend/test/enrichmentRoutes.test.js` (adjust if it asserts the old no-proposal shape)

**Interfaces:**
- Produces: `getReview(db, id)` returns `{ has_proposal: false, finished_at: Date|null }` when the artist has no proposal, and `match.wrong_identity: boolean` when it has one (true exactly when `proposal.l4c2_status === 'WRONG_MBID_IDENTITY_CORRECTED'`). `finish(db, id, finished)` returns that `getReview` result, for an artist with or without a proposal; unknown artist is `NOT_FOUND`, a non-boolean is `BAD_INPUT`.

- [ ] **Step 1: Write the failing tests.** Read test: change `'no proposal -> has_proposal false'` to expect `{ has_proposal: false, finished_at: null }`; add `'no proposal but a finished review row: finished_at is returned'` (insert a review row with `finished_at` for a no-proposal artist via `mkReview(id, {finished: true})`, assert `has_proposal === false` and `finished_at instanceof Date`); add `'match.wrong_identity is true only for a WRONG_MBID_IDENTITY_CORRECTED verdict'` (two artists via `mkProposal`, one with `conflicts: { l4c2_resolution: { status: 'WRONG_MBID_IDENTITY_CORRECTED' } }`, one with `GAP_FILLED`, one with none: assert true / false / false). Write test: `'finish works for an artist with no proposal, and reopens'` (`finish(pool,id,true)` gives `has_proposal:false` and a non-null `finished_at`; `finish(pool,id,false)` gives null); `'finish for an unknown artist is NOT_FOUND and a non-boolean is BAD_INPUT'`. Update any existing test that expects `finish` to be `NOT_FOUND` for "No proposal for this artist".
- [ ] **Step 2: Run to verify they fail.** `cd backend && node --test --test-concurrency=1 test/enrichmentRead.test.js test/enrichmentWrite.test.js test/enrichmentRoutes.test.js`. Expected: the new/changed tests FAIL.
- [ ] **Step 3: Implement in `artistEnrichment.js`.** In `getReview`, read the review row before the `if (!proposal)` return and return `{ has_proposal: false, finished_at: review ? review.finished_at : null }`; add `wrong_identity: wrongId` to the returned `match` object. In `finish`, keep the boolean check, replace `reviewWithProposal` with a plain `await getReview(db, artistId)` (it throws `NOT_FOUND` for an unknown artist), then `upsertFinished`, then `return getReview(...)`.
- [ ] **Step 4: Run to verify they pass, then the whole suite.** Same command, then `npm test -- --test-concurrency=1`. Expected: all pass (the previous count was 815).
- [ ] **Step 5: Commit.** `git checkout -b session-artist-workbench` first (if not already on it); `git add backend/services/artistEnrichment.js backend/test/enrichmentRead.test.js backend/test/enrichmentWrite.test.js backend/test/enrichmentRoutes.test.js`; message `feat(enrichment): wrong_identity flag; Mark done works without a proposal`.

---

### Task 2: Pure view helpers

**Files:**
- Create: `frontend/src/utils/workbenchView.js`, `frontend/src/utils/workbenchView.test.js`

**Interfaces (all pure, no DOM; lookups through `Map`/`Set` so `constructor` can never be a result):**
- `tabFromSearch(search: string): 'details' | 'catalogue'`: `?tab=catalogue` gives `'catalogue'`; absent, empty, any other value (including `constructor`, `CATALOGUE`) gives `'details'`.
- `searchWithTab(search: string, tab: string): string`: returns a query string starting `?` (or `''` when empty). `'catalogue'` sets `tab=catalogue`; `'details'` (or anything unknown) removes `tab`. Other params (for example `mergeWith`) are preserved.
- `mergeWithFromSearch(search: string, selfId: number): number | null`: the `mergeWith` param when it is a positive safe integer different from `selfId`, else `null`.
- `searchWithoutMergeWith(search: string): string`: same as above with `mergeWith` removed.
- `bannerItems(review): Array<{ key: string, kind: 'shared' | 'wrong', text: string, actionLabel: string, otherId?: number }>`: `[]` when `review` is falsy or `!review.has_proposal`. One `shared` item per entry of `review.match.shared_with` (`key: 'shared:<id>'`, `text: 'Another artist uses the same MusicBrainz id: <name> (<n> songs)'`, `actionLabel: 'Review merge'`, `otherId`), then one `wrong` item when `review.match.wrong_identity` (`key: 'wrong'`, `text: 'A later check found this MusicBrainz id belongs to a different act'`, `actionLabel: 'Check match'`).
- `identityStatus(identity: {spotify, bandcamp, musicbrainz}, review): { label: string, tone: 'ok' | 'todo' }`: `n` = number of the three ids that are falsy, plus 1 when `review && review.has_proposal && (review.match.state === 'pretrusted' || review.match.state === 'needs-approval')`; `n === 0` gives `{label: 'done', tone: 'ok'}`, else `{label: '<n> to check', tone: 'todo'}`.

- [ ] **Step 1: Write the failing test file.** Cases: tab parsing (absent, `?tab=catalogue`, `?tab=constructor`, `?x=1&tab=catalogue`); `searchWithTab` round-trips and keeps `mergeWith`; `searchWithTab('', 'details') === ''`; `mergeWithFromSearch('?mergeWith=7', 3) === 7`, `('?mergeWith=3', 3) === null`, `('?mergeWith=abc', 3) === null`, `('?mergeWith=-2', 3) === null`, `('?mergeWith=7.5', 3) === null`, `('', 3) === null`; `bannerItems`: no proposal gives `[]`, two partners plus `wrong_identity` gives 3 items in that order with the exact texts above, none gives `[]`; `identityStatus`: all three set and state `approved` gives `done/ok`, one unset gives `1 to check`, one unset plus `needs-approval` gives `2 to check`, `review` null counts only unset ids.
- [ ] **Step 2: Run to verify it fails.** `cd frontend && node --test src/utils/workbenchView.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `workbenchView.js`** to the interface above using `URLSearchParams`.
- [ ] **Step 4: Run to verify it passes.** Expected: PASS.
- [ ] **Step 5: Commit.** `git add frontend/src/utils/workbenchView.js frontend/src/utils/workbenchView.test.js`; message `feat(admin): pure helpers for the artist workbench shell`.

---

### Task 3: Lift the review into a hook; extract the match step

**Files:**
- Create: `frontend/src/components/admin/useEnrichmentReview.js`, `frontend/src/components/admin/MatchStep.jsx`
- Modify: `frontend/src/components/admin/EnrichmentPanel.jsx`

**Interfaces:**
- Produces: `useEnrichmentReview(artist, { onIdentitySaved, onChanged }): { review, error, setError, busy, load, act, decide, acceptField, acceptMember, finishCall, finish }`. Behaviour is **moved unchanged** from today's `EnrichmentPanel` (lines 49-120): the `mounted` and `seq` guards, `load` on mount and whenever `artist.id`, `artist.musicbrainz_id` or `artist.bandcamp_url` change, `act(fn, { identity })` (success sets the returned review and calls `onChanged`, then `onIdentitySaved` when `identity`; failure sets the error and re-reads), `decide(decision)`, `acceptField(f)`, `acceptMember(m)`, `finishCall(finished)` (PUT `/finish`, then dispatch `window` event `enrichment-changed`, return the review), `finish(finished)` (`act(() => finishCall(finished))`, resolving to a boolean).
- `<MatchStep artist enr onMerge />` renders today's match block (current JSX for `match.state !== 'none'`: state label, method and confidence, "Check on MusicBrainz", song counts, Spotify/Bandcamp/albums lines, the stored-id-differs line, `warnings` for `match`, Approve / Reject / Not sure / Decide now / Undo decision). It owns the local `unsure` state. The "Another artist has this id" line and its `Merge...` link are **removed** (the banner owns that); `onMerge` is not used by it (drop the prop). It renders nothing when `!review || !review.has_proposal || review.match.state === 'none'`.
- `<EnrichmentPanel artist enr onChanged onIdentitySaved />` keeps only rows, members, "Accept all shown", the accepted / needs-your-check lines and the skipped set. It **always shows the rows** (no collapsed "Reviewed" view) and no longer renders Done / Reopen / Next artist or the match block. Accept all keeps its auto-finish when nothing is left over (`enr.finishCall(true)` inside its `act`). It renders nothing when `!enr.review || !enr.review.has_proposal`.

- [ ] **Step 1: Create the hook** by moving the state and functions listed above out of `EnrichmentPanel.jsx` (no behaviour change).
- [ ] **Step 2: Create `MatchStep.jsx`** by moving the match JSX; delete the shared-id "Merge..." markup. Keep `methodLabel`, `confidenceLabel`, `stateLabel`, `spotifyArtistLink`, `albumLine`, `sourceLink` imports it uses.
- [ ] **Step 3: Slim `EnrichmentPanel.jsx`** to the props above.
- [ ] **Step 4: Verify.** `cd frontend && npm run lint && npm run build` (0 errors; the 4 existing lint warnings are expected). The workbench still imports the old `EnrichmentPanel` signature, so this task leaves the app temporarily inconsistent: **do not run the app until Task 6**. Run `node --test $(find src -name "*.test.js")` (251 + Task 2's new tests, all passing).
- [ ] **Step 5: Commit.** `git add frontend/src/components/admin/useEnrichmentReview.js frontend/src/components/admin/MatchStep.jsx frontend/src/components/admin/EnrichmentPanel.jsx`; message `refactor(admin): lift the enrichment review into a hook, extract the match step`.

---

### Task 4: Merge dialog

**Files:**
- Create: `frontend/src/components/admin/MergeDialog.jsx`
- Modify: `frontend/src/styles/admin.css` (the dialog classes, below)
- Delete (in Task 6, when nothing imports it): `ArtistMergePanel.jsx`

**Interfaces:**
- `<MergeDialog artist initialOther onClose onMerged />`: `artist` = `{id, name, songs, live_songs}`; `initialOther` = a positive integer or `null` (null opens on the name search); `onClose()`; `onMerged(keeperId)`.
- Behaviour is `ArtistMergePanel`'s logic moved unchanged: debounced search, `choose`, `defaultKeeper`, the preview fetch with its sequence guard, the stale-preview error with **Refresh preview**, `previewLines`, the server hash check, and `window.dispatchEvent(new Event('enrichment-changed'))` after a success. Changes: (a) presentation is a modal: backdrop, `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title ("Merge two artists"); (b) two cards in a row, `.aw-card.is-keep` titled **Stays** and `.aw-card.is-gone` titled **Disappears**, each with name, `n songs · m live`, `id`; (c) **Swap direction** button and the line "Default: the one with more songs stays"; (d) the preview lines in a `<ul class="aw-sum">`; (e) the confirm button is `btn` danger-styled with the text `Merge: delete <name of the artist that disappears>`; the `window.confirm` is **removed** (the button names what it deletes and the preview hash guards staleness); (f) focus moves into the dialog on open (the search input, or the Swap button when an artist is chosen), Tab is trapped inside, **Escape and a backdrop click call `onClose` unless a merge is running**, and the confirm button is disabled while `busy` or without a preview.
- Focus return: the dialog does not manage it; the opener (Task 6) restores focus to the element that opened it in `onClose`.

- [ ] **Step 1: Write the component** per the interface.
- [ ] **Step 2: Add CSS** to `admin.css` (tokens only): `.aw-backdrop` (fixed inset; first run `grep -n "modal\|backdrop" frontend/src/styles/*.css` and reuse an existing modal backdrop class or colour if one exists, otherwise use `rgb(0 0 0 / 0.55)`, the one permitted literal), `.aw-dialog` (max-width `34rem`, `--bg-surface`, border, `--radius-lg`, padding `--space-4`), `.aw-cards` (flex, gap), `.aw-card`, `.aw-card.is-keep` (border `--accent-moss-60`), `.aw-card.is-gone` (border `--color-danger`), `.aw-sum` (padding-left, `0.85rem`).
- [ ] **Step 3: Verify.** `npm run lint && npm run build` (0 errors). Visual check happens in Task 7.
- [ ] **Step 4: Commit.** `git add frontend/src/components/admin/MergeDialog.jsx frontend/src/styles/admin.css`; message `feat(admin): merge as a dialog`.

---

### Task 5: Section 1 - identity and links as table rows

**Files:**
- Modify: `frontend/src/components/admin/IdentifyPanel.jsx`
- Create: `frontend/src/components/admin/IdentitySection.jsx`
- Modify: `frontend/src/styles/admin.css` (`.aw-section*`, `.aw-pill` tones)

**Interfaces:**
- `IdentifyPanel` keeps every prop and all logic (search, candidates, paste for MusicBrainz and Bandcamp, enrichment-proposed id first, Replace-Spotify confirm, Clear confirm). Only the render changes: the card with "Identify sources" and its Done button is replaced by a `<ul class="adm-list">` of three `.adm-row` rows (Spotify, MusicBrainz, Bandcamp), each: `.adm-col-label` (source name), `.adm-col-name` value (the link, ellipsised; "not set" muted), a `.adm-pill` state (`saved`, or `not set`), and a right-aligned action group (**Find** / **Change** / **Clear**, a link-open icon text "Open ↗"). The expanded search body renders as an `.adm-sub`-style full-width block under its row (candidate rows, search box, paste form) exactly as today. Each row gets `id="aw-row-<source>"` so the banner can scroll to it. A new optional prop `renderAfterRow(source)` returns extra content shown under that row; `IdentitySection` uses it to place `MatchStep` under the MusicBrainz row.
- `<IdentitySection artist enr save focus onIdentitySaved onMerge />`: a `.aw-section` with header `1 · Identity and links` plus an `.adm-pill` from `identityStatus(identity, enr.review)` (tone `todo` uses `--accent-ember-60`, `ok` uses `--accent-moss-60`); body = `IdentifyPanel` (with `renderAfterRow` returning `<MatchStep artist enr />` for `musicbrainz`), a Website row (`.adm-row`, `.adm-col-label` "Website", `<AutoText label="Website" placeholder="https://" initial={artist.website_url} onSave={(v) => save({ website_url: v })} inline />`), and an `.adm-actions` line with a text button **Merge with another artist...** that calls `onMerge(null)`. `focus` = `{open, n}` as today (`key={focus.n}` re-mounts `IdentifyPanel` with that row open; `ArtistLinksPanel` did this).

- [ ] **Step 1: Restyle `IdentifyPanel` render** as above (no logic change). Remove the now-unused `onDone` prop.
- [ ] **Step 2: Write `IdentitySection.jsx`.**
- [ ] **Step 3: CSS** for `.aw-section` (border `--border-hairline`, `--radius-lg`, `--bg-surface`, margin-bottom `--space-3`), `.aw-section-head` (flex, gap, bold `0.9rem`, `--bg-surface-raised`, padding), `.aw-section-body` (padding), and `.adm-pill.is-ok` / `.adm-pill.is-todo` tone modifiers.
- [ ] **Step 4: Verify.** `npm run lint && npm run build`.
- [ ] **Step 5: Commit.** `git add frontend/src/components/admin/IdentifyPanel.jsx frontend/src/components/admin/IdentitySection.jsx frontend/src/styles/admin.css`; message `feat(admin): identity and links as section 1`.

---

### Task 6: The shell

**Files:**
- Rewrite: `frontend/src/components/admin/ArtistWorkbench.jsx`
- Modify: `frontend/src/components/admin/ArtistDetailsPanel.jsx` (remove the Name `AutoText`), `frontend/src/styles/admin.css` (`.aw-header`, `.aw-banner*`, `.aw-tabs`, `.aw-tab`, `.aw-footer`)
- Delete: `frontend/src/components/admin/ArtistLinksPanel.jsx`, `frontend/src/components/admin/ArtistMergePanel.jsx`

**Interfaces:**
- `ArtistWorkbench` (the route component at `/admin/artist/:id`): keeps today's artist loading (`reload`, `save`, the request `token`, `notFound`, `idRef`), `navState` / `idx` / `go` / `back` / `goNext`, and renders `<WorkbenchBody key={`${artist.id}:${mergeKey}`} ... />` once the artist is loaded; `mergeKey` is bumped by the merge-into-this-artist path (as today).
- `WorkbenchBody` props: `artist, save, reload, onIdentitySaved, goNext, go, idx, navState, back, onMerged`. It owns: `useEnrichmentReview(artist, { onIdentitySaved, onChanged: () => setFactsKey(k => k + 1) })`; `tab = tabFromSearch(location.search)`; `mergeOpen` = `null` or `{ other: number|null }` (initialised from `mergeWithFromSearch(location.search, artist.id)`); `focus`, `refreshKey`, `factsKey` as today; the opener element for focus return.
- Layout, top to bottom:
  1. **Header** (`.aw-header`, inside the existing sticky `.wb-topbar`): Back to Artists, the name as `<AutoText inline label="Name" initial={artist.name} onSave={(v) => save({ name: v })} />` styled as the title, `n songs · m live`, Prev / Next.
  2. **Banner** (`.aw-banner`, only when `bannerItems(enr.review)` is non-empty): one `.aw-banner-row` per item: a bold "Needs you" tag, the text, and a button with `actionLabel`. `shared` calls `openMerge(otherId)`; `wrong` scrolls `#aw-row-musicbrainz` into view (`scrollIntoView({ block: 'center' })`) and focuses its first button.
  3. **Tabs** (`.aw-tabs`, `role="tablist"`): Details and Catalogue; selecting one calls `navigate({ search: searchWithTab(location.search, key) }, { replace: true })`. The URL is the state.
  4. **Details tab:** `<IdentitySection .../>`, then a muted `.aw-todo` note "Basics and Story are being rebuilt; the panels below stay until then", then the temporary stack: `<ArtistDetailsPanel/>` (bio, advocacy notes, "no advocacy notes needed", genres), `<EnrichmentPanel/>`, `<ArtistFactsPanel key={artist.id} artist onNeedIdentity refreshKey={factsKey}/>`. Then the **footer** (`.aw-footer`): when `enr.review && enr.review.finished_at` it shows "Reviewed" with **Reopen** (`enr.finish(false)`) and **Next artist →** (`goNext`); otherwise one primary button **Mark artist done · Next artist →** which runs `enr.finish(true)` and, on success, `goNext()`. The footer shows nothing until `enr.review` has loaded, and works when `has_proposal` is false.
  5. **Catalogue tab:** the existing `<CatalogueReview .../>` unchanged (same props: `identity`, `onNeedIdentity`, `refreshKey`, `reviewed`, `onReviewedChange`), then a "Catalogue review notes" `AutoText` (multiline, `discography_review_notes`) beneath it. Both tabs stay mounted? No: render only the active tab (Catalogue reads sources on mount, which must not happen while on Details).
  6. **Merge dialog:** `mergeOpen && <MergeDialog artist={artist} initialOther={mergeOpen.other} onClose={closeMerge} onMerged={onMerged} />`. `openMerge(other)` records `document.activeElement`; `closeMerge()` clears `mergeOpen`, removes `mergeWith` from the URL with `searchWithoutMergeWith` (replace), and returns focus to the recorded element.
- The old two-column `.wb-grid` markup is gone from this page; do not delete the `.wb-grid` CSS (the song workbench uses it).

- [ ] **Step 1: Rewrite `ArtistWorkbench.jsx`** per the interface (keep `onMerged` semantics: navigate to the keeper with `replace: true`; when the keeper is this artist also `reload()` and bump `refreshKey`, `factsKey`, `mergeKey`).
- [ ] **Step 2: Remove Name from `ArtistDetailsPanel.jsx`.** Delete `ArtistLinksPanel.jsx` and `ArtistMergePanel.jsx` (`git rm`).
- [ ] **Step 3: CSS** for the header, banner (border `--accent-ember-60`, tinted background via `color-mix(in oklch, var(--accent-ember-60) 12%, var(--bg-surface))`), tabs (underline on the active tab), footer.
- [ ] **Step 4: Verify.** `cd frontend && npm run lint && npm run build && node --test $(find src -name "*.test.js")`. Expected: 0 lint errors, build clean, all frontend tests pass. Then `cd ../backend && npm test -- --test-concurrency=1` (all pass).
- [ ] **Step 5: Commit.** `git add frontend/src/components/admin/ArtistWorkbench.jsx frontend/src/components/admin/ArtistDetailsPanel.jsx frontend/src/styles/admin.css` plus `git rm` of the two deleted files; message `feat(admin): artist workbench shell (banner, tabs, section 1, merge dialog, done footer)`.

---

### Task 7: Browser verification, docs, hand-off

**Files:**
- Create (outside the repo, in the session scratchpad): a throwaway Vite mock harness.
- Modify: `docs/PROJECT_STATE.md`, `CLAUDE.md`, `docs/PROJECT_PLAN.md` (mark the slice).

- [ ] **Step 1: Build the mock harness** exactly as the `admin-ui-mock-harness-review` memory describes (own `vite.config.js` rooted in the scratchpad, port **5199** `strictPort`, react/react-dom/react-router-dom resolved to `frontend/node_modules`, `fs.allow` the repo, `main.jsx` importing the global CSS in `App.jsx` order and mounting `ArtistWorkbench` in a `MemoryRouter` at `/admin/artist/81`, an alias swapping `frontend/src/api/adminApi.js` for a mock `adminFetch` with a `?scenario=` switch). Never type `ADMIN_PASSWORD`; never start on 5000/5173; stop only your own harness PID.
- [ ] **Step 2: Mock scenarios** with canned JSON: `shared` (Earth Crisis: `shared_with` one partner, `wrong_identity` false), `wrong` (`wrong_identity` true, state `needs-approval`), `none` (`has_proposal: false`, `finished_at: null`), `finished` (`finished_at` set), `clean` (no banner).
- [ ] **Step 3: Drive the harness in a real browser** (claude-in-chrome; a design-review subagent is acceptable) and confirm, at about 1100px and at 390px: the banner shows for `shared` and `wrong` only and its buttons work (Review merge opens the dialog with the partner chosen; Check match scrolls to the MusicBrainz row); tabs switch and `?tab=catalogue` survives a reload; the Catalogue tab does not read sources while Details is showing; the dialog traps Tab, closes on Escape and the backdrop, and ignores both while a mock merge is pending, and focus returns to the opener; `?mergeWith=` with self, junk and a missing artist behaves as in Review Focus 3; the `none` scenario shows no banner, no match row, no enrichment rows, and Mark artist done works and the footer then reads Reviewed; no horizontal page scroll at 390px; admin table classes are used (no unstyled inputs or buttons). Never click anything that triggers `window.confirm`.
- [ ] **Step 4: Fix anything found** (each fix: reproduce in the harness, change, re-check, re-run lint, build and the frontend tests).
- [ ] **Step 5: Docs.** Append to `docs/PROJECT_STATE.md` (Current State entry plus Changelog line, CRLF-safe script): slice 1 built on `session-artist-workbench`, NOT merged, the curator smoke steps below. Update `CLAUDE.md`'s Frontend Structure paragraph: `ArtistWorkbench` is a loader plus `WorkbenchBody`; `useEnrichmentReview`, `MatchStep`, `MergeDialog` (replaces `ArtistMergePanel`), `IdentitySection`; `ArtistLinksPanel` is gone; `workbenchView.js`; and the backend note that `getReview` carries `match.wrong_identity` and `finish` needs no proposal. Mark slice 1 in `docs/PROJECT_PLAN.md`. Commit (`git add` the three docs); message `docs: artist workbench slice 1`.
- [ ] **Step 6: Push the branch** (`git push -u origin session-artist-workbench`), do **not** merge, and post the curator smoke steps **in full in chat**:
  1. Restart the backend (check the :5000 process tree first) and run `cd frontend && npm run dev`; sign in yourself.
  2. Open `/admin/artist/81`: the page has a header with an editable name, tabs, and section 1 with Spotify, MusicBrainz, Bandcamp and Website rows.
  3. Open an artist that shares a MusicBrainz id (Artists > Enrichment > Possible duplicates, if any remain) or one from Match to approve: a red "Needs you" banner shows for a shared id; **Review merge** opens a dialog with Stays / Disappears cards, Swap, a plain preview and a button naming what it deletes; Escape closes it.
  4. Open Culture Shock (#3625): the banner says a later check found the id belongs to a different act and **Check match** scrolls to the MusicBrainz row, where the match needs approval.
  5. Change a link (Find / Change / Clear) and paste a MusicBrainz link; Approve or Reject a match under the MusicBrainz row; edit the Website.
  6. Switch to the Catalogue tab (the address gains `?tab=catalogue`); reload and it stays; the catalogue behaves as before; the review notes sit under it.
  7. Back on Details: Accept all shown still works; **Mark artist done · Next artist →** moves on; reopen the artist and it shows Reviewed / Reopen. Try an artist with no staged proposal: Mark done works.
  8. Merge a real duplicate if you have one (Disl Auto into Disl Automatic): the page goes to the artist that stays and no banner remains.

## Self-review notes

- Spec coverage for slice 1: shell, banner (shared, wrong), tabs with `?tab=`, footer (done / reopen / next), merge dialog (banner, section 1, `?mergeWith=`), section 1 incl. Website and match step, finish without proposal, Name in the header, Catalogue notes on the Catalogue tab. Slices 2 to 4 (Basics, members, Story, Catalogue table B, the `{n} new` tab pill) are intentionally absent.
- Type consistency: `enr` is the hook result everywhere; `bannerItems`, `identityStatus`, `tabFromSearch`, `searchWithTab`, `mergeWithFromSearch`, `searchWithoutMergeWith` names are used identically in Tasks 2, 5 and 6.
- Left to the builder: exact CSS values beyond the listed tokens, copy tweaks, keyboard order inside the banner, loading skeletons, and how `renderAfterRow` is threaded.
