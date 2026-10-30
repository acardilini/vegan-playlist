# Leads queue - design

Date: 2026-10-31. Status: **draft for the curator's approval; nothing built.** Piece 3 of 4 (lyrics fetch and Artist facts are done; piece 4 is the Claude Code skills). Background: `2026-10-29-leads-and-thread-tool-brainstorm-notes.md`. Decisions are the curator's unless marked **(my call)**.

## Why

While searching for a song or reading Reddit, the curator stumbles on a band that looks relevant: often just a name, sometimes a song, sometimes a claim ("the singer is vegan"). They want to capture it in seconds without leaving what they are doing, and be reminded later to look into it properly. Today there is nowhere to put "look into this band", so it is lost.

## What gets built

1. **A top-level admin tab "Leads"** in the admin menu (beside Songs, Artists, Playlist cross-check), at `/admin/leads`. The admin menu is visible inside every workbench, so it is one click from wherever the curator is.
2. **Quick capture at the top of the Leads tab.** One band-name box plus an optional note field; press Enter to add. Name is the only required field. The curator can open an optional "more" row for: a song they saw, and a link. The box clears and stays focused so several leads can be added in a row.
3. **The list** shows leads that are *To look into* (default), with filters for *Checked* and *Dismissed*, newest first. A row shows the band name, the note, the song and the link (a real link, opens in a new tab), the date added, and a badge **already an artist** when the name matches an existing artist.
4. **Per-lead actions:** **Promote**, **Dismiss**, **Mark checked**, **Restore** (from Dismissed or Checked back to To look into), edit the note, delete a mistaken lead.
5. **Promote** creates the artist (a manual-source artist with the lead's name, no identity set) and opens its workbench at `/admin/artist/:id`; the lead becomes *Checked* and keeps a pointer to the artist. If the name already matches an artist, Promote just opens that artist's workbench instead of creating one. The lead's note, song and link are copied into the artist's existing **Notes** field (as a short dated line) so nothing captured is lost. **(my call)**
6. **A visible count** of leads To look into on the Leads tab label and on the Dashboard, so it works as the reminder.
7. **Duplicate handling** **(my call)**: adding a name that matches an existing lead or artist (case and diacritics ignored, whitespace collapsed) does not add a second row. It says what it matched: "Already a lead (To look into)", "Already a lead, dismissed on <date>: Restore?", or "Already an artist: Open". Matching is by name only and never merges, stamps or changes anything.
8. **Source-agnostic capture** **(my call)**: the service that adds a lead takes `{ name, note, song, url, origin }` and can be called by the later Reddit-thread skill (piece 4) as well as the quick-add form, so piece 4 needs no change to the leads model. `origin` is `manual` here.

## Constraints

- Free and local: no external call, no LLM, no new frontend dependency; admin routes sit behind the existing `X-Admin-Password` router and use `adminFetch`.
- Migration is additive (a new `leads` table); it must not touch songs, artists or any of the 650-song dataset.
- Nothing a lead holds is ever public; a lead is invisible to every public route.
- Names and notes are plain text, shown as text (no HTML), with sensible length limits; a link must be http(s).
- The admin nav, queue and workbench styling follow the existing admin patterns (queue list, `QueueRail`-style status filters where they fit).

## Non-goals

- Extracting leads from Reddit threads, claim/status parsing, or any LLM step (piece 4).
- Vegan-claim records, statuses or evidence on leads; the Facts panel already holds members and the vegan mark on artists.
- Importing a lead's song, or looking anything up on Spotify, Bandcamp or MusicBrainz from the lead itself; that happens in the artist workbench after Promote.
- Merging leads, bulk import, tags, priorities, due dates or notifications.

## Anti-goals (a failure even if it works)

- Capture that takes more than a name and Enter; a form with required fields beyond the name.
- A dismissed band coming back as a fresh lead, or a duplicate lead for the same band.
- Promote creating a second artist for a band that already exists, or silently losing what was captured.
- A lead leaking into the public site or the song counts.

## Left to the builder

- Table shape and migration number, the list/filter queries and counts, and route names.
- Exact placement of the optional fields, the empty state, and how the count reaches the Dashboard and the tab label.
- Whether the Leads tab reuses the Artists queue components or is a smaller purpose-built list.
- The exact name-normalisation function (reusing an existing normaliser is fine if it folds case and diacritics).

## Settled after the builder check (all **my calls**, for the curator to overrule)

- **Name matching** folds case and diacritics, ignores punctuation and a leading "The", and collapses whitespace. It compares against `artists.name` only (no aliases). "Already an artist" is computed live when the list loads, never stored on the lead.
- **A Checked lead still blocks a re-add** ("Already a lead (Checked)" with Restore), including when its artist was later deleted.
- **The artist pointer** is `leads.artist_id` with `ON DELETE SET NULL`, so deleting an artist never fails because of a lead. Promote is one transaction (create artist if needed, append the Notes line, mark the lead Checked).
- **Promote's Notes line** is appended to the artist's existing "Catalogue review notes" field (`artists.discography_review_notes`), never overwriting it, as `Lead (<date>): <note> · song: <song> · <link>` (only the parts present). A lead that already has an artist just opens it and adds no second line.
- **"Manual-source artist"** means `data_source = 'manual'` with no Spotify identity, exactly as `staging` already creates them. No change to the `artists` table.
- **Count.** The list endpoint returns per-status counts. The Leads tab label shows the To look into count (fetched once after login and refreshed whenever a lead changes) and the Dashboard gets one tile linking to `/admin/leads`; zero shows `0`.
- **Limits.** Name 255, note 1000, song 255, link 500 characters. `origin` is a short word (30 characters at most, default `manual`). The add service takes one lead per call.
