# Session 1.3 — Curator Decision List

_Generated 2026-07-07 at the end of the data-integrity pass. These are the items the
integrity scripts deliberately **did not** auto-apply because they are curatorial judgment
calls, not mechanical fixes. Work through them here (or in the Session 1.4 admin UI). Song
ids are given so a follow-up script can act precisely._

The mechanical part of 1.3 is already done: 18 duplicate pairs merged, 19 orphan albums + 1
orphan artist removed, and the previously-blocked lyrics applied (song_lyrics 929 → 947).

> **Curator ruling — 2026-07-07:** _"Where something has one instance of include, default to
> include. The 'rejected' mark was likely because it was already included in the original
> data."_ This resolves **Groups A, B, and C** below:
> - **A & B (18 status conflicts): keep INCLUDED — no DB change** (the DB already has them
>   `included` + live; the sheet's reject/pending was the "already in the data" note). They
>   will keep appearing on consolidation reports since the spreadsheet is unchanged, but
>   nothing acts on them.
> - **C (CLEARxCUT): DONE** — pending duplicate **5804 merged into the included row 80** and
>   removed (backup `backups/pre-clearxcut-merge-*.dump`). pending 178 → 177, songs 1801 → 1800.
>
> Groups D–I remain optional/informational (enrichment and unmatched rows); tackle in Session
> 1.4 or later.

---

## A. Sheet-vs-DB status conflicts — spreadsheet says REJECT, DB has INCLUDED (13)

The curator marked these "reject" in the missing-from-playlist spreadsheet, but the DB row is
`included` + `published` (live on the site). Per the Session 1.1 rule, the import never
overrides curator state — you decide. **If reject wins:** set `status='rejected'`, unpublish.

| Song id | Artist — Title |
|--------|----------------|
| 4 | Antagonist A.D — Show Some Heart (Go Vegan) |
| 166 | Antagonist A.D — Show Some Heart II |
| 368 | Arkangel — Day of Apocalypse |
| 4790 | Carcass — Unfit for Human Consumption |
| 4883 | Escalate — The damage is done |
| 152 | Icons Of Filth — Show Us You Care |
| 2597 | Insted — Feel Their Pain |
| 4930 | Jens Friebe — Theke Mit Den Toten |
| 88 | Refused — The Slayer |
| 4976 | René-Marc Bini — A.L.F. Le jour J |
| 4977 | René-Marc Bini — A.L.F. The Call of Justice |
| 4978 | René-Marc Bini — A.L.F. Our Freedom Is to Have No Choice |
| 5049 | Vicious Embrace — Cease Life |

## B. Sheet-vs-DB status conflicts — spreadsheet says PENDING, DB has INCLUDED (5)

Spreadsheet marks these still-to-process, but they're already live. Decide: keep live, or
pull back to `pending` (unpublish) for re-review.

| Song id | Artist — Title |
|--------|----------------|
| 42 | Poison Girls — The Offending Article |
| 412 | Stinkbrute — Carnist Cult Drones |
| 409 | Stinkbrute — Death Row |
| 4909 | xUnworthy Of Lifex — Enslaved |
| 4908 | xconsumetosatisfyx — Sacrifice |

## C. New duplicate surfaced by the 1.2 playlist diff (1) — RECOMMEND action

`CLEARxCUT — The Keys to the Cages` now exists **twice**: song **80** (included, live) and song
**5804** (pending — added automatically by the Session 1.2 playlist diff). Same title+artist.
**Recommendation:** reject/delete pending **5804** (keep the curated included row 80). Left for
you rather than auto-merged because 5804 is an unreviewed pending row.

## D. Unmatched playlist-spreadsheet rows — no DB song to attach lyrics to (3)

These rows are in the lyrics spreadsheet but matched no DB song (so their lyrics weren't
applied). Likely title-format mismatches; confirm the song exists under a different title or
add it.

- MDC — `Chicken Squawk - Millions of Dead Children/Chicken Squawk 7"` (messy title cell)
- Earth Crisis — The Order That Shall Be
- Dropdead — Unjustified Murder - Remaster 2020

## E. Unclassified "Processed" values (2)

The spreadsheet's Processed column held a value the importer couldn't classify; the song was
left `pending` with the raw value in `status_notes`.

- Fall Of Efrafa — No Longer Human  (Processed = "Not on spotify")
- Poison Girls — The Offending Article  (Processed = "already in playlist") — see also B/42

## F. Remaining multi-matches that are NOT duplicates — confirm & optionally map lyrics (2 groups)

The 18 true dup pairs are merged. These remain multi-match because one spreadsheet row maps to
several genuinely-distinct songs, so lyrics weren't auto-applied:

- **King Alpha / Tena Stelin — Animal Rights (Vox 1 / Vox 2 / Vox 3)** → songs 123, 124, 197.
  Three vocal versions. Map each Vox row to its song if you want per-version lyrics.
- **Destroy Babylon — Vegan Straight Edge Saved My Life** → song 305 vs 4853 ("Bonus Track").
  Treated as distinct (not a dup). Confirm.

## G. "Lyrics not found" in sheet, but DB already has a lyrics_url (5) — INFO, likely no action

The importer kept the existing URL rather than wiping it to "not found". Nothing to do unless
the existing link is wrong.

- 465 Existance — Operation Successful · 463 Conflict — Slaughter of Innocene ·
  233 Diego Luna/Gustavo Santaolalla — The Apology Song · 61 Pretenders — I'll Stand by You ·
  28 The Smiths — Meat Is Murder - 2011 Remaster

---

## H. Spotify-attach misses from Session 1.2 (34 manual songs)

These manual songs didn't attach to Spotify. They render fine as manual-only (placeholder
art), so **no action is required** — but attaching adds album art/enrichment.

### H1. Clear typos/format — fix the title/artist then re-run attach (RECOMMEND)
After fixing, run `node scripts/enrichFromSpotify.js --attach --apply`.

| Song | Current | Fix to |
|------|---------|--------|
| Kali — Cognitive D dissonance | title typo | Cognitive Dissonance |
| Sentience — -269 | title format | (269) |
| Freaki Jenni — Adopt dont shop | title | Adopt, Don't Shop |
| Queen V — Only One Life | artist | Vegan Queen V — Only One Life |
| Queen V — What Hell Is Like | artist | Vegan Queen V — What Hell Is Like |
| Manic Street Preachers — Small Black Flowers…Remastered Version | title | …2016 Remastered Version |

### H2. Artist typo but tracks probably a different Spotify artist — UNCERTAIN
- **Scared Earth** (4 songs: To Burn Apathy, Sentience, Three Thousand, Poisoned World) →
  possibly "Sacred Earth", but Spotify's "Sacred Earth" looks like an unrelated world/meditation
  act. Verify before attaching.
- Nueva Etica — Declaration de Guerra → possibly "Nueva Ética".

### H3. No confident Spotify match found — leave as manual-only (no action)
Animal Liberation Songs (Faroe Island Massacre, Poisoned Paradise) · Jah Sun — No Bones No
Blood · Mistro (Evil Industry, Until Every Cage Is Empty) · Moral Law — Retribution · No
Restraint — The Branches of Suffering · Point of Existence (×2) · Police Bastard — Second Skin
(Remix) · Sendero — Sendero · Seven Generations — Ritual · Sods Law — War on Wildlife · Steve
White & The Protest Family — The Side of the Fox · The Ex — Vivisection (Live) · Thomas D —
Gebet an den Planet 11.0 · Upraised — No More Apologies · VVANDEL — 10,000 Tears · Vegains —
Vegan Savage - Remix · Vegan Artist Bjt — Vegan Batman · Worst Witch — Vile Language · xElegyx
(Crimson Dawn, Elegy, Solitary Resolution).

### H4. Attached OK, but Spotify credits an extra artist not linked (11) — OPTIONAL
Secondary artist links weren't added (conservative attach). Add the co-artist if you want full
credits: Chucho Merchan — Liberación Animal (Ana Milena Cuítiva, Yoki Barrios, Andrés Delgado) ·
Earthfall — Dirty Money (Confronto) · Masta Quba — Plant Based (P. Jaguar) · Mr. Hip — The
Future is Vegan (Veganz N Da Hood) · Mr. Hip — Spirit Animal (Doc G) · Peplon — Glass Walls
(Anna Lundquist) · Pikayzo — Was haben wir getan? (Der Asiate) · Sendero — Venganza (Jeronimo
Ruíz) · Slewfoot — Blood On Your Hands (Street Justice) · Sons of Aguirre — Velociraptor Vegano
(Scila) · Stressed — Bullet (Gravitate).

---

## I. Optional: 149 included songs not on the Spotify playlist

The Session 1.2 diff found 149 included songs that aren't on the "Animal Lib & Vegan Songs"
Spotify playlist (the website is the master). If you want the Spotify playlist to mirror the
site, add them by hand — `GET /api/admin/spotify-playlist-mismatch` lists them. No effect on
the site either way.
