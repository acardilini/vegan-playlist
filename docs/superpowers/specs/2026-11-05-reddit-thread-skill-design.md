# Reddit thread skill (piece 4) - design

Date: 2026-11-05. Status: **draft for the curator's approval; nothing built.** Supersedes the "thread tool" parts of
`2026-10-29-leads-and-thread-tool-brainstorm-notes.md`. Pieces 1-3 (Bandcamp lyrics, artist facts, Leads) are built and merged.

## Why

When a Reddit thread asks for vegan music, the replies hold good suggestions, but reading ~700 comments, noting the bands and
songs, and checking each against the catalogue by hand is the laborious part. The curator's by-hand routine today:
read the thread, note the suggested artists and songs; look each song up in the catalogue and, if it is missing, search for it
and judge whether it belongs; check each artist for songs already held and, if none, note the band down as a lead.
Replies also make **claims about who is vegan** ("Joe Duplantier of Gojira"), often disputed in-thread. Those are worth keeping
as unconfirmed notes for later, not publishing.

The skill does the reading, noting and first-pass sorting. **The curator still does every judgement** (is it right for the
playlist, is the claim true).

## What the curator decided

- **Free.** No paid API and no in-app LLM call. The extraction is Claude in a Claude Code session, packaged as a repeatable project skill.
- **Input is pasted thread text** (Reddit returns 403 to direct fetches from this machine). A long thread is pasted in chunks, one run per chunk.
- **Before anything is saved the curator sees a quick overview**: what was pulled from the thread, and for each item whether it is
  **new** or something **we already have**.
- **Approved named songs go to Songs > To be processed** (pending), not to the Playlist cross-check.
- **A song by a band that is not an artist yet goes to Leads** (the song recorded on the lead), not to To be processed.
- **Vegan claims are captured, including disputed and retracted ones**, into a new **admin-only notes area** on the artist
  ("to be integrated into the info later"). For a band that is only a lead, the claims sit on the lead and move to the artist on Promote.
- The artist-facts proposer skill from the original piece 4 is **dropped** (deferred; record in the plan's Backlog). The curator is
  adding MusicBrainz links to every artist that has a page, and the built Fill from MusicBrainz covers country, years and members.

## Goals / non-goals / anti-goals

**Goals:** one paste -> an overview -> one approval -> bands, songs and claims land in the right queue. Re-pasting a thread, or the
next chunk of it, never duplicates anything.

**Non-goals:** showing claims on the public site; touching `artist_members` or its vegan marks (the curator integrates claims by
hand later); fetching Reddit automatically; a new admin screen for the import itself (the overview is in the chat); the
facts-proposer skill; any other site than pasted text.

**Anti-goals (failure even if it "works"):** anything unconfirmed reaching a public route; a claim written into
`vegan_advocacy_notes` (that field decides whether an artist leaves the Needs-advocacy-notes queue, so a thread claim there would
make an unreviewed artist look finished); the same band or song added twice; a commenter's Reddit username stored anywhere; any
write before the curator approves; any risk to the 650-song curated dataset (existing songs and artists are never edited by the import
except for appending to the new claims field).

## How it works

Three parts, all in the repo.

1. **The skill** - `.claude/skills/reddit-thread-import/SKILL.md` (checked in). Instructs Claude, given pasted thread text and the
   thread URL, to:
   - extract **mentions** into the JSON shape below, ignoring ads, usernames, vote counts, jokes, self-promotion and off-topic argument;
   - **merge repeats** of the same band within the paste;
   - keep only a **short supporting quote** (about 200 characters at most) per claim, and never record a commenter's username;
   - write the JSON to the scratchpad and run the script in dry-run mode, then show the curator the overview;
   - wait for approval ("go", or "go except 4, 9"), then run apply with the skipped numbers.
2. **The script** - `backend/scripts/importThread.js`. Reads the JSON file, connects with the existing `database/db.js` pool (direct
   DB access, as the other scripts do; **never the admin password or an HTTP call**). **Dry-run by default** (the convention of
   `enrichFromSpotify.js`); `--apply` writes; `--skip 4,9` leaves numbered items out. Prints the overview as a plain table.
3. **The service** - `backend/services/threadImport.js`, holding the logic so it is testable: `plan(db, extracted)` is read-only and
   returns numbered items with a classification; `apply(db, extracted, {skip})` **re-plans at write time** (so a stale overview can
   never cause a write the current data would not allow) and then writes the non-skipped items.

### Extracted JSON

```json
{ "thread": { "url": "https://www.reddit.com/r/vegan/comments/...", "title": "Vegans in music" },
  "mentions": [ {
      "artist": "Gojira", "songs": ["Fishing for Fishies"], "genre": "metal",
      "claims": [ { "person": "Joe Duplantier", "status": "vegan",
                    "quote": "short quote", "disputed": false, "dispute": null } ] } ] }
```
`status` is one of `vegan`, `vegetarian`, `formerly_vegan`, `not_vegan`, `unsure`. `person` may be "all members" or empty for a
whole-band claim. `songs`, `genre` and `claims` may be empty.

### Classification of each mention (the overview)

Band identity uses the existing `leadKey` fold (case, diacritics, punctuation, leading "The") against `artists.name` and `leads.name_key`.
A song is "already have" when `bandCheck/merge.keyOf(title)` matches any song of that artist **in any status** (live, pending, rejected).

| Band is... | Each named song | Band itself | Claims |
|---|---|---|---|
| **An existing artist** | held song -> *already have* (shows its status); not held -> **new song**, pending under that artist | *already an artist* (flag "no songs yet" if it has none) | appended to the artist's claims notes |
| **An existing lead** (any status) | listed in the overview only | *already a lead* (shows its status) | appended to the lead's claims, **except** a dismissed lead: nothing is written |
| **Unknown** | the first-named songs are recorded on the new lead | **new lead** | stored on the new lead |

- A **new song** is a manual pending song via `staging.insertManualCandidate` (title + artist, no Spotify link; attach one in the workbench as for any
  manual song), with status note `added via reddit thread (<thread url>)`. `curation.js`'s origin CASE gains
  `WHEN s.status_notes LIKE 'added via reddit thread%' THEN 'redditthread'`, and the queue label becomes **"From Reddit thread"**.
- A **new lead** is `leads.addLead` with `origin: 'reddit'`, `url` = the thread URL, `song` = the named songs joined by "; " (cut to the 255 limit), `note` = the genre if given.
- An unknown band whose **only** claims are `not_vegan` or `unsure` and which names no song is **unticked by default** in the overview ("skipped: nothing to
  follow up") so it does not clutter Leads; the curator can still include it by number. Everything else is included by default.
- A band that is an existing artist with a claim still gets the claim written even if it has nothing else new.

### Claim lines

One line per claim, appended (never replacing) to the claims field:
`Reddit 2026-11-05 · <thread url> · Joe Duplantier: vegan - "short quote"` plus ` · disputed: <dispute>` when disputed. A line is skipped if the same line
without its date is already present (so re-pasting is harmless). Writes append with `||` in one statement, as Promote does.

### Where claims live and show

- New migration **019**: `artists.thread_claims TEXT` and `leads.thread_claims TEXT` (additive, idempotent, nullable). Applied to the local DB; must be applied on any other.
- `leads.promoteLead` appends the lead's claims to the artist's `thread_claims` (once, in the same transaction; a lead already promoted adds nothing again).
- **Artist workbench**: an editable "Claims from threads" notes box (admin-only), shown wherever the Notes tab shows the other notes, saved like them through the
  whitelisted `services/artists.update`. **Leads tab**: each row shows its claims (read-only is enough; edit inline is not required).
- It is **in no queue predicate** and in no public route. A test asserts `GET /api/spotify/artists/:id` and the other public reads never return it, mirroring the Leads test.

## Constraints

- YAGNI: no new admin screen, no new route unless the claims box needs `PUT /api/admin/artists/:id` (which already exists; only the whitelist grows).
- Errors from the script are fixed strings; nothing logs the pasted text beyond what the overview shows.
- Tests are `node:test`, sentinel `ZZZTHR`, never touching real rows; `plan`/`apply` take the db so tests use fixture JSON. The LLM step is not unit-testable;
  its first test is a **real dry-run on the example thread** (r/vegan "Vegans in music", pasted by the curator), reviewed together.
- Sub-project rules: the current Start-/End-Session guides, docs updated, curator smoke before merge.

## Left to the builder

File layout of the service, the exact overview table format, the SKILL.md wording, how the skill is told the thread URL (asking the curator is fine), chunk handling
beyond "each paste is one run", and the small frontend layout of the claims box and the lead row.

## Smoke (curator)

Paste a chunk of the example thread -> read the overview (new vs already have looks right) -> approve with one skip -> see new bands in Leads (with the thread link and
claims), new songs under To be processed tagged "From Reddit thread", claims on an existing artist's workbench -> paste the same chunk again and see everything reported
as already there with no new writes -> Promote a lead that carries claims and see them on the artist.
