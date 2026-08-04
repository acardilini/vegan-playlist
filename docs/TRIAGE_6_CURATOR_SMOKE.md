# Triage 6 — About: analysis explainer, AI disclosure, and editable page copy: curator smoke checklist

**Status: BUILT, held for your smoke — NOT merged.** Branch `session-triage-6-about-analysis`,
from `main` at `84e0841`. Every automated gate is green: backend **179/179**, frontend module
tests **36** (9 utils + 27 explore), lint **0 errors** (6 pre-existing warnings, none from this
session), build clean (JS bundle **726.27 kB**), and a Puppeteer smoke of **10/10** checks —
real DOM, real navigation, a real click-through from a Reference term to a filtered browse page,
real fallback rendering with the API blocked, and a real 390px layout check. This file is what
none of that can judge: whether the writing reads right and whether the page is usable at its
real size.

No §0 restart step: your `:5000` backend is nodemon and picks up backend changes on its own; the
frontend is plain Vite. Just check out the branch and both dev servers will pick it up live.

```
git checkout session-triage-6-about-analysis
```

---

## §1 Editing the copy — how this actually works

This is the part built specifically so you can do it yourself, so it goes first.

- **Two files, plain Markdown:**
  - `backend/data/about.md` — the About tab (mission, what we include, our approach, get
    involved).
  - `backend/data/analysis.md` — the "How the analysis works" tab (the explainer + AI
    disclosure).
- **An edit is live on your next browser refresh. No rebuild, no restart.** The backend reads the
  file straight off disk on every request.
- **Live figures are tokens, not typed numbers.** Write `{{songs}}`, not `1,333` — the number is
  substituted at render time from the live database, so it can never go stale under your prose.
  The full token list:

  | Token | Renders as (today) |
  |---|---|
  | `{{songs}}` | `1,333` |
  | `{{artists}}` | `635` |
  | `{{analysed}}` | `693` |
  | `{{analysedPct}}` | `52%` |
  | `{{mapped}}` | `640` |
  | `{{codingModels}}` | `gemini-3.5-flash-lite` (every model in the latest coding pass, most-songs first) |
  | `{{codingDate}}` | `July 2026` |

- [ ] **Try it once, on something low-stakes.** Open `analysis.md`, change a word in a sentence
      that doesn't touch a token, save, refresh the browser tab. Confirm your change appears
      immediately with no server restart. Then, separately, **type a token wrong on purpose**
      (e.g. `{{song}}` instead of `{{songs}}`) and refresh — confirm it shows up on the page as
      the literal text `{{song}}` rather than vanishing or breaking the page. That's
      deliberate: an unrecognised token renders as itself so a typo is visible to you, not silent.
      Undo both test edits when you're done.

## §2 Does the explainer read as honest, not defensive?

The whole point of "How the analysis works" is telling a visitor plainly what's machine-made and
what isn't, without either overselling the tech or hedging so much it reads as an apology.

- [ ] Read the page top to bottom as a first-time visitor would. Does it feel like a
      straightforward account of a process, or does it feel like it's justifying itself?
- [ ] The page states the human work (the codebooks — designed and iterated by you over multiple
      rounds) **before** the machine work (the per-song coding, model-generated). That order was
      a deliberate call — the reasoning was that the human part is what makes the machine part
      mean anything. Reading it now: does that order still feel right, or would you rather lead
      with the coding itself?
- [ ] The line "the per-song coding is model-generated and currently unchecked" is in there
      un-softened, per your own wording from the brainstorm. Say if you want it phrased
      differently now that you can see it in context.

## §3 Is the AI disclosure specific enough?

- [ ] Find the sentence built from `{{codingModels}}` / `{{codingDate}}` (currently: "each
      song's most recent coding pass came from `gemini-3.5-flash-lite`" as of `July 2026`).
      Is naming the model(s) and the date the right level of specific, or does a reader need
      more (or less) to trust it?
- [ ] `{{codingModels}}` lists **every** model behind the current live data, in order of how many
      songs it covers. Today that's two names, one of which covers a single song
      (`gemma4:deep_pipeline`, 1 song, next to `gemini-3.5-flash-lite`'s 692). Does listing the
      one-song outlier read as honest transparency or as clutter? If you'd rather it read
      differently, that's a wording choice you can make directly in `analysis.md` — the token
      always lists what's really there; how you frame it around the token is yours.

## §4 Is the human/machine distinction clear to someone who didn't build it?

- [ ] Without referring back to this checklist, could you explain to someone else — in one or two
      sentences — which parts of the site's analysis are a person's judgement and which are a
      model's output, using only what the page says? If you have to reach for outside knowledge
      to answer that, the page needs to say more.
- [ ] The "What this doesn't tell you" section at the bottom states the codes describe what a
      song *says*, not whether it's any good, and that coding is unchecked with human checking as
      possible future work. Does that read as a fair caveat, or does it undersell work you're
      confident in?

## §5 Is the Reference page navigable at 141 terms, or overwhelming?

- [ ] Open `/about/reference`. It's one long scroll with a sticky jump bar at the top
      (Themes · Lyric metadata · Sound). Use the jump bar to get to each of the three families —
      does it get you there fast, or does the page still feel like too much to scan?
- [ ] Every dimension/component loads **collapsed**. Open a few. Does that default (collapsed,
      not everything expanded) feel right for a first visit, or would you rather land on
      something already open?
- [ ] Find a term with **`0 songs`** next to it (there are several — the four "absence" codes
      stay hidden everywhere, but plenty of real thematic terms currently have no coded song).
      Its count is plain text, not a link — confirm that reads as intentional ("nothing to click
      through to") rather than as a broken link.
- [ ] Click a term that **does** have a count. It should take you to the main Browse page with
      that filter already applied and real results showing. Does that connection between the
      glossary and the catalogue feel useful, or like an unexpected place to end up?
- [ ] Under a Sound dimension (Energy, Mood, Rhythm, Instruments, Vocals, Tempo), each code shows
      a method line and a threshold (e.g. a Librosa RMS/spectral-centroid cutoff). Is that level
      of technical detail welcome here, or too far into the weeds for a public page?
- [ ] Shrink the window to phone width and re-check the jump bar and a couple of terms — does
      anything feel cramped or broken at that size?

## §6 Regressions — things this session should not have touched

- [ ] `/about` itself — the mission, what-we-include, approach and get-involved sections, plus
      the three stat badges — should look and read exactly as it did before this session (the
      words moved into `about.md`, but nothing new was written for the visible top-level page).
- [ ] The rest of the site (Browse, a song page, Explore, Playlists) — quick click-through to
      confirm nothing outside `/about` moved.

## §7 Open question this session could NOT resolve — please answer before merge

`analysis.md`'s **"Where the rest of the information comes from"** section currently states:

> Genre, album and release data come from Spotify. Moods, languages and the highlighted lyrics on
> a song page are entered by hand.

That claim was written from reading the **schema** (`songs.custom_mood` looks curator-entered;
genre resolves through `EFFECTIVE_GENRE_EXPR`, which is Spotify-derived with a fallback) — it has
**not** been confirmed by you. A wrong provenance claim is about the worst thing to get wrong on a
page whose entire purpose is transparency, so:

- [ ] **Please confirm or correct this sentence before the branch merges.** If any of it is wrong
      — e.g. if genre is sometimes hand-set, or a "mood" sometimes comes from Spotify — edit
      `analysis.md` directly (it's live on refresh, per §1) or flag it and it'll get fixed.

---

## If something is wrong

Note which numbered item, and what you saw versus what you expected. §2–§5's questions are
mostly judgement calls, not bugs — say what you'd rather have instead and it can be changed in
the Markdown directly in most cases, no code change needed.

---

## What is left

Once this smoke passes (and any wording changes from it land), the branch merges and the queue
moves to the next Phase 4 sub-project — **C** (submissions moderation / Inbox), **D** (YouTube
search assist), **E** (lyrics-search assist), **F** (Spotify push) — none of which are started.

Two small, unrelated items are carried forward from earlier sessions, not part of this one: the
**Year range** browse control still has the placeholder-clipping and ellipsis-chip bugs the
Tempo range fixed months ago; and the `margin: 0 auto` container no-stretch sweep (the bug Batch B
found and fixed on the Explore map) is narrowed but not closed — `.page-container` and
`.about-container` were checked this session and are both fine, but the remaining page components
haven't been checked yet.
