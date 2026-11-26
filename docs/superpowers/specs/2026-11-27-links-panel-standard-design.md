# Links panel on the admin standard - design (small change)

**Why.** The curator asked to apply `docs/ADMIN_UI.md` to the song workbench's **Links** panel next. Today each of Spotify, Bandcamp and SoundCloud is a labelled input with an Open button on a separate line, plus separate action rows and a long checkbox sentence; the "Other platforms" section repeats "ours is ..." text the top bar already shows.

**Goals.** The panel reads as one compact table; the URL is the flexible column; Open is one small link per row; actions are grouped on one line. **Non-goals.** No behaviour, route or data changes (same saves, same Spotify attach / push / dormant logic, same Confirm/Reject); no other panels.

**Design.**
- A table (`.adm-list`) with a header (Site | Link): rows **Spotify**, **Bandcamp / website**, **SoundCloud**. Each row = a fixed label column, the URL input as the flexible column (no label above; autosave tag after it), and a small **Open ↗** link (only when a URL is set). The Bandcamp **Search** link sits on the actions line (built that way so every row's Open cell is the same width and the inputs line up).
- One **actions line** under the table for Spotify: **Attach by search** (only when no Spotify id), **Add to playlist**, and a checkbox **Link no longer plays** (the long explanation moves to its tooltip). Messages and **Add anyway** stay under it.
- **Other platforms** is a second `.adm-list` (header Platform | Link): the link cell says "On the song page" (confirmed) or "To check" (proposed), and a proposed row shows `Found "Title" by Artist` on a line beneath (the song's own title is in the top bar, so "ours is ..." goes), a small **Open ↗**, and **Confirm** / **Reject** for a proposed link or the muted "on the song page" for a confirmed one.
- `AutoText` gains an `inline` prop (input only, with `aria-label`, followed by its save tag); the labelled form is unchanged for every other panel.
- New shared classes in `admin.css` for the standard: `.adm-col-label`, `.adm-col-field`, `.adm-col-open`, `.adm-actions`; added to `docs/ADMIN_UI.md`.
