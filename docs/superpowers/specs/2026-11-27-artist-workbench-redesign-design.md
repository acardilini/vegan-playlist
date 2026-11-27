# Artist workbench redesign: design

**Date:** 2026-11-27 · **Status:** draft for curator approval · **Branch (when built):** `session-artist-workbench`
**Brainstorm record:** this session; mockups in `.superpowers/brainstorm/4808-1795772426/content/` (`structure.html`, `details-v2.html`, `catalogue-v1.html`, `merge-v1.html`; git-ignored).

## 1. Intent and why

The artist workbench (`/admin/artist/:id`, `ArtistWorkbench.jsx`) is the page the curator opens for one artist. Today it is two columns: Catalogue on its own on the left, and six stacked panels on the right (Details, Links, Proposed enrichment, Facts, Notes, Merge). The same facts (country, years, members) appear in three of those panels. Warnings are small coloured text inside whichever panel raised them, Merge opens off-screen at the bottom, and the Catalogue column is a long run of buttons, warning boxes and per-song controls. The curator finds both columns badly organised and the Catalogue column the worst.

The curator works in **two distinct modes**, at different times:

1. **Settling an artist's details**, now: links and merge check first, then the simple facts (country, first and last release, members), then the thoughtful text (summary, advocacy notes, vegan stance and its evidence). The curator wants all of an artist's information on the one page, and wants to edit the short summary texts.
2. **Catalogue review**, later (probably after the site is live): working through an artist's catalogue to find new songs, to build out the playlist slowly.

The redesign gives each mode its own tab, orders the Details tab in the order the curator works, makes serious problems impossible to miss, and gives the analysis project's staged bio, notes, stance and evidence a home.

## 2. Goals, non-goals, anti-goals

**Goals**
- One artist page with two tabs: **Details** and **Catalogue**.
- Details = three numbered sections in working order: **1 Identity and links**, **2 Basics** (facts and members), **3 Story** (summary, advocacy notes, stance, evidence). Everything visible, nothing to expand.
- A red **"Needs you"** banner for serious problems (shared or wrong MusicBrainz identity), with a **Merge dialog**.
- A members table: name, role, current or former, vegan indicator, source.
- Story editable by hand, with the analysis's suggestion shown beneath each text box and an explicit "Use this" button.
- Catalogue tab as one flat table of **new** songs (default), with an All view; source health and counts in one strip; Apply bar pinned.
- Follow `docs/ADMIN_UI.md` (tables, one flexible column, state shown not announced, density) throughout.

**Non-goals (YAGNI)**
- The Artists list page and its queues stay as they are (they adopt the new look only when next touched).
- The public artist page is a separate, later project.
- No new queues for bio, stance or story (can follow once Story exists).
- Member tenure years, aliases and per-member evidence text beyond a link are not shown.
- No change to the Catalogue/band-check back end, to lyrics handling, or to the analysis project.

**Anti-goals (a failure even if it technically works)**
- Anything that fills a vegan tick, a stance or a text box without the curator's click. No bulk approve. "Accept all shown" stays fill-only and **never includes Story**.
- A page that hides a problem (a serious identity problem collapsed, scrolled away or only in small text).
- Risk to the 650-song curated dataset: no write path may touch songs, lyrics or `song_artists` other than the existing merge service.

## 3. Constraints

- **Option A invariant:** the web app never writes `artist_enrichment_proposals`; it reads it live. Decisions live in the web-owned tables. Only `services/artistEnrichment.js` may reference the proposals and review tables (test-enforced).
- **Relaxed read rule (this project):** `artistEnrichment.js` may now additionally read `proposed_bio`, `proposed_vegan_notes`, `artist_vegan_stance`, `advocacy_confidence`, `evidence_snippets` and `evidence_urls`, and a member's `vegan_evidence_url` and `vegan_confidence`. The explicit-column rule stays (never `SELECT *`); website, Wikidata and Wikipedia columns and the raw Bandcamp text stay unread. The scan test in `enrichmentRead.test.js` is updated to this list.
- `artist_members.vegan` is **curator-only**. The analysis's member evidence is only a link beside the tick; nothing is ticked for the curator.
- Single writers stay: `artists.update` (never identity), `bandCheck.saveIdentity` (identity), `artistFacts` (facts and members), `artistMerge` (merge).
- Public reads are unchanged except where a later step says so; nothing here changes what the public site shows.
- Frontend: tokens only (`--space-*`, `--text-*`), `docs/ADMIN_UI.md` classes; pure logic in `frontend/src/utils/*.js` with `node --test`; backend tests use a unique sentinel per file and `--test-concurrency=1`.
- Nothing merges to `main` before the curator says "Merge" after a smoke test; each slice is smoke-tested.

## 4. Approaches considered

1. **Staged, in place (chosen).** Rebuild the page on the live route in four slices, replacing old panels as each is rebuilt. The page always works and the curator smoke-tests each slice; the Details tab arrives first, which is the work they will do now. Cost: the page looks partly old and partly new between slices.
2. **New page beside the old one.** Build the whole workbench on a separate route and switch at the end. No half-new page, but the curator waits for everything, and two pages exist for a while.
3. **Restyle only.** Cheapest, but it does not deliver the Details/Catalogue split, the members table or Story, so it does not solve the problem. Rejected.

## 5. The design

### 5.1 Shell
- Header row: artist name (inline editable), `{songs} songs · {live} live`, Prev / Next (the queue's id list, as today).
- **"Needs you" banner** under the header, one line per serious item, each with its action button. Items that raise it: (a) the MusicBrainz id is also proposed for or stored on another artist (`shared_with`), action **Review merge**; (b) the analysis's later check found the proposed MusicBrainz id belongs to a different act (`WRONG_MBID_IDENTITY_CORRECTED`, already guarded in the reader), action **Check match**, which scrolls to the MusicBrainz row in section 1. The banner is absent when nothing qualifies. Lesser findings (a year later than the catalogue's earliest album, and so on) stay as a warning mark on their own row in Basics, not in the banner.
- Tabs: **Details** and **Catalogue** (with a "{n} new" pill once its data has been read). The tab is in the URL (`?tab=catalogue`) so a reload or a link keeps it. Default Details.
- Details footer: **Mark artist done · Next artist →** (sets the existing enrichment-finished flag, then goes to the next in the list). Catalogue has its own **Mark catalogue reviewed** (the existing `discography_reviewed`). The two are independent.

### 5.2 Details tab
Three sections, each a bordered block with a number, a title and a status pill (to check / to review / done / not started), all expanded.

**1 Identity and links.** A table, one row per link: Spotify, MusicBrainz, Bandcamp, Website. Columns: label, flexible value (the link, openable), state tag (confirmed, proposed, check), and one action (Accept / Find / Clear), per `ADMIN_UI.md`. The existing identity search and paste behaviour of `IdentifyPanel` (Spotify/Bandcamp/MusicBrainz candidates, paste a MusicBrainz link or id, enrichment-proposed id offered first, ask before Clear) and the website save are kept and restyled into these rows. The proposed MusicBrainz match is a row state with Approve / Reject / Undo decision (as today's `decideMatch`). A **Merge with another artist…** link in this section opens the same Merge dialog with a name search, for a duplicate nobody flagged.

**2 Basics.** A table of facts: Country, Formed, Disbanded, First release, Last release, Genres. Each row: label, current value (editable inline for the curator), the proposal when it differs (value, source, confidence), a warning mark where the reader warns, and **Accept** / **Skip** as today (locked rows show why). **Accept all shown** (fill-only, as today) is offered when it would do something and **excludes Story**. Below the facts, the **Members table**: Name, Role, Status (Current/Former), Vegan, Source. Name, role and status are editable inline; the Vegan cell is the curator's tick, with a small "evidence ↗" link when the analysis staged evidence for that member (a hint only); a source tag; ✕ to remove (confirm). Proposed members that are not stored yet appear as rows marked "proposed" with an Add button; **Add member** adds a blank row.

**3 Story.** Always visible:
- **Short summary (bio)** and **Advocacy notes**: an editable text box each (autosave, as `AutoText` does today). Beneath each, when the analysis staged text, a "Suggested by the analysis" block with a button: **Use this** when the box is empty, **Replace with this** when it already holds text (explicit, never automatic). The existing "No advocacy notes needed" checkbox stays beside Advocacy notes.
- **Vegan stance**: the curator's value (a select with the six values below plus "Not set"), the analysis's suggestion with its confidence, and **Confirm** to take the suggestion.
- **Evidence**: the staged sources as rows (domain link and the quoted snippet), read-only, five shown with "+ n more" expanding in place.
- **Catalogue review notes** (`discography_review_notes`) move to the Catalogue tab; it is catalogue work.

The same Details section also keeps `Name` (header) and the **Genres** row (Basics).

### 5.3 Merge dialog
A modal opened from the banner, from section 1, or from the Possible duplicates queue's `?mergeWith=` link. Content: two cards (green **Stays**, red **Disappears**) with songs, live songs and id; **Swap**; the preview in plain lines (songs moving, members moving or skipped, fills, conflicts where the stayer wins, identity carried or kept); Cancel and **Merge: delete {name}**. The default direction is the existing `defaultKeeper`; the preview is `GET .../merge-preview` and the merge is `POST .../merge` with its hash, unchanged. The dialog traps focus, closes on Escape, and ends by going to the artist that stays. `ArtistMergePanel.jsx` is retired.

### 5.4 Catalogue tab
One flat table of **new** songs by default: Process, Reject (narrow columns), Song, Release, Year, Found on (source chips), Lyrics (chip and Read / Add). A **New | All** switch; All shows the whole catalogue grouped by release as today. A status strip: source health pills (a failing or partial source is a coloured pill with its message, a suspect source a clickable pill that opens its link row), then the counts line, Refresh, Fetch lyrics, Mark catalogue reviewed. Prompts ("nothing new left", "n new since you marked this reviewed") become one-line messages in the strip. The Apply bar is pinned at the bottom ("Apply: process p · reject r", Select all new, Apply). Catalogue review notes sit under the table. The band-check back end, lyrics fetch and per-song behaviour are unchanged.

### 5.5 Data and back end
- **Migration 030:** `artist_members.role TEXT` (nullable, trimmed, max 80 chars). `artistFacts.addMember` / `updateMember` accept it; `proposeFromMusicBrainz` (read-only) offers a role from the MusicBrainz member relation's instrument or vocal attribute where present, and `musicbrainzFacts.js` parses it.
- **Migration 031:** `artists.vegan_stance TEXT` nullable with a CHECK of the allowed values: `EXPLICIT_VEGAN_BAND`, `VEGAN_MEMBERS`, `VEGETARIAN_OR_ANIMAL_RIGHTS`, `THEMATIC_OR_SINGLE_SONG`, `SEARCHED_UNVERIFIED`, `NOT_SEARCHED`. `artists.update` whitelists it. Labels in a pure frontend util (a `Map`).
- **Reader:** `artistEnrichment.getReview` gains a `story` block `{bio, advocacy_notes, stance, stance_confidence, evidence: [{url, claim, snippet}]}` and, on member rows, `vegan_hint: {url, confidence} | null`. A `story` row is only returned for text and stance that differ from what is stored.
- **Writer:** `POST /api/admin/artists/:id/enrichment/accept-story` `{field: 'bio' | 'advocacy_notes' | 'stance'}`: the client names only the field; the server re-reads the staged value, and writes it through `artists.update`. Never part of `acceptAll`. As with the other accepts, the server writes whatever it reads at that moment, not a value the client sends.
- **Artists with no staged proposal** (about 120 of 921) still get the whole page: Basics and Story simply show no proposals and the curator edits by hand. `enrichment/finish` (Mark artist done) no longer requires a proposal: it only needs the artist to exist (`upsertFinished` already needs nothing else). The Enrichment queues are built on proposals, so such an artist is not listed under Enrichment > Done; it is still reachable from All artists.
- **No other table is written.** Proposals stay read-only. The member vegan flag is never written by an accept.

### 5.6 Slices (each ends with a smoke test by the curator and a PROJECT_STATE entry)
1. **Shell:** header, banner, tabs, footer, Merge dialog, section 1 (links restyled), the existing Catalogue and old side panels temporarily kept under the right tab or section until replaced. Includes the `?tab=` URL state.
2. **Basics and members:** facts table, genres, members table with role (migration 030, MusicBrainz role prefill, vegan evidence hint).
3. **Story:** migration 031, reader and `accept-story`, the Story section.
4. **Catalogue tab B** and retirement of the old panels and CSS.

## 6. What is left to the builder
Component and file names, CSS, exact microcopy, keyboard order, how the banner scrolls to a row, empty and error states, and responsive behaviour (admin is desktop-first; it must not break at a narrow width). The builder checks every new panel in a real browser through the throwaway mock-harness method (never typing the admin password).

## 7. Calls I made (curator to correct)
- Role is free text, optional, prefilled from MusicBrainz where it states an instrument; no controlled list.
- Stance values are the analysis's six; "Not set" is stored as NULL.
- "Use this" is **Replace with this** when a text is already saved.
- Catalogue review notes live on the Catalogue tab.
- "Mark artist done" has no checklist; it only sets the flag.
- Genres sit in Basics. The Merge dialog also serves "Merge with another artist…".
- Mark artist done works for an artist with no proposal (see 5.5).
- The banner is only for identity problems (shared or wrong MusicBrainz id); other warnings stay on their rows.
