# Artist facts - design

Date: 2026-10-31. Status: **draft for the curator's approval; nothing built.** Piece 2 of 4 (lyrics fetch done; then Leads queue; then Claude Code skills). Decisions are the curator's unless marked **(my call)**.

## Why

The playlist's question about a band is whether it has relevant songs. Around that, the curator wants a few plain facts on each artist page: where they are from, when they formed, whether they are still active, who is in the band, and which members are vegan. Today an artist has a bio and advocacy notes only. Collecting facts by hand is slow, so a source (MusicBrainz, already wired) **proposes** and the curator **checks**. An LLM never writes facts into the database, and never writes bios.

## What gets built

1. **A Facts panel in the artist workbench** (alongside Details, Links, Catalogue, Notes), working like the Band check and cross-check flows: nothing is saved until the curator accepts it.
   - **Fill from MusicBrainz** button. Needs the artist's confirmed MusicBrainz link (already stored); without one the panel says to set it under Links.
   - It reads that one MusicBrainz artist and shows **proposals**, one row each, with **Accept** and **Skip**: country, year formed, disbanded year (if any), last release year, members (name, current or past).
   - The curator can also type or edit any fact by hand.
2. **Each fact is stored with its source** ("MusicBrainz", "Added by curator"), shown in the panel as the lyrics source already is. An accepted proposal keeps its source label; a hand-typed value is "Added by curator".
3. **Members.** A list of names with current/past, and a **vegan mark** per member. MusicBrainz can never supply the vegan mark; it is set by the curator only and blank until then.
4. **Active status is automatic from the last release, with a curator override.** Active when the last release year is within the last 3 years **(my call on the 3)**, otherwise inactive; a disbanded year means not active. The curator can set Active / Not active by hand, and that wins until cleared. Shown as "Active, last release 2024" or "Inactive, last release 2012".
5. **Public artist page** (design settled with the curator from mockups, option A with the V mark):
   - A one-line summary under the artist name: `Germany · Formed 2009 · Active, last release 2024`.
   - A plain **Members** line under the Biography, with a small green **V in a circle** (like a restaurant menu's vegan mark) after each vegan member's name.
   - **Every element is hidden when it has no value**: no country means no country part of the line; no members means no Members line; no facts at all means no summary line (the same rule the bio already follows).
6. Only **accepted** facts are ever public. A proposal that is not accepted lives nowhere.

## Constraints

- No LLM in this piece. The later skill (piece 4) must be able to feed the same accept rows; keep the proposal shape source-agnostic **(my call)**.
- MusicBrainz is paced to about 1.1 s per request and its failures are coded, fixed-string errors; nothing logs a URL or fetch error message (as the Band check adapter already does).
- No paid service, no new frontend dependency.
- Identity stays curator-confirmed: Fill never changes the artist's MusicBrainz link (`bandCheck.saveIdentity` stays the only writer).
- Accepting a proposal never overwrites a value the curator typed by hand without showing both (the row shows current and proposed).
- The 650-song dataset is untouched: facts attach to artists only, via a migration that adds columns or a table; no song row changes.

## Non-goals

- Bios written by an LLM or any prose generation; vegan status of the band as a whole beyond the per-member mark.
- Other sources (Wikipedia, Spotify, Bandcamp) or an LLM proposer; those come with piece 4.
- A public edit or suggestion path, a Facts queue in the Artists rail, or a "needs facts" count (the Leads queue is the next piece).
- Photos, social links, genres.

## Anti-goals (a failure even if it works)

- Showing an unchecked fact publicly, or a wrong country or year with no source trail.
- A MusicBrainz entry for a different band with the same name filling in confident but wrong facts (the link is curator-confirmed, and the panel names the MusicBrainz artist it read).
- A public page that shows empty labels, "Unknown" or placeholders.

## Left to the builder

- Storage shape (columns on `artists` vs a facts table plus a members table), migration numbering, and how the source label is stored per fact.
- The exact MusicBrainz calls (artist lookup with relations, release groups) and how "last release" is chosen when release groups include compilations or live albums **(builder's judgement; flag the rule chosen)**.
- Panel layout, routes and where the automatic Active is computed (server on read is fine).
- How a re-fill treats facts already accepted (show current vs proposed; never silently replace).

## Settled after the builder check (all **my calls**, for the curator to overrule)

- **Last release** = the newest first-release date among MusicBrainz release groups of type Album, EP or Single, excluding any with a secondary type of Live, Compilation, Remix or Demo. A live album or compilation therefore never keeps a band "Active".
- **Re-fill.** A proposal equal to the stored value is not shown. A differing one shows current beside proposed, and Accept replaces only on that click. **Skip stores nothing**, so the proposal reappears on the next fill. Stored facts are by definition accepted; there is no "accepted" flag.
- **Members on re-fill.** Matched by name ignoring case and diacritics. A matching member keeps its vegan mark and only takes MusicBrainz's current/past flag on Accept. A member the curator added by hand and MusicBrainz lacks is never removed. Accept is per member; nothing is deleted by a fill.
- **Which MusicBrainz relations are members.** "Member of band" relations only. Current = no end date and not ended; past otherwise. Live and touring-only relations are skipped if MusicBrainz marks them so; the panel shows what it read so the curator can check.
- **Country.** The artist's `country` ISO code, shown as an English name (no new dependency); if absent, no country proposal. Formed year is the year of `life-span.begin`, proposed only when present; disbanded year from `life-span.end` when `ended` is true.
- **Override vs disbanded.** The curator's Active / Not active override beats everything, including a disbanded year. With an override but no last release year the line reads just "Active" or "Inactive". With nothing at all, no active text shows.
