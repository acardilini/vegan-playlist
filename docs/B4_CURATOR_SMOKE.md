# B4 — Explore map + similar songs: curator smoke checklist

**Branch:** `session-B4-explore-map` · **Status:** **ALL 12 tasks built.** The map half (Tasks 1–7) was
finished first and held for this smoke; you were away from a computer, so you asked for the second half
(Tasks 8–12 — the song page's similarity tabs) to be built too. Both halves are now waiting on you, so
this checklist covers both: **§1–§4 are the map, §6 is the song page.**
Plan: [`superpowers/plans/2026-07-27-B4-explore-vector-map.md`](./superpowers/plans/2026-07-27-B4-explore-vector-map.md) ·
Spec: [`superpowers/specs/2026-07-27-B4-explore-vector-map-design.md`](./superpowers/specs/2026-07-27-B4-explore-vector-map-design.md)

Everything below has passed automated checks (backend 159/159, lint 0 errors, build clean, and headless
browser runs). **None of it has been looked at by a human.** That is what this list is for — and the items
under §4 are the ones no test can answer.

---

## 0. Before you start — no restart needed (this instruction was wrong)

**Corrected 2026-07-27.** This section used to tell you to restart your backend. That was based on a
stale note claiming your `:5000` was a plain `node server.js`. It is not — it is **nodemon**
(`npm run dev`), and it was verified live to be picking up this branch's brand-new routes within seconds
of them being written. **Just make sure you are on the branch**; nodemon reloads the backend and Vite
reloads the frontend.

```
git checkout session-B4-explore-map      # if not already on it
```

_Minor housekeeping, not a blocker: there are currently **two** nodemon processes running against this
repo (PIDs 20344 and 34528). Only one owns `:5000`. If you see odd double-restarts in your terminal, that
is why — closing the stray one is harmless._

---

## 1. Nav and routing

- [ ] The top nav reads `Home · Artists · Playlists · **Explore** · Submit Song · About · Admin` — Explore
      after Playlists, and **no Dashboard item**.
- [ ] `/explore` opens on the **Map** tab; `/explore/data` shows the analytics dashboard.
- [ ] **`/dashboard` redirects** to `/explore/data` (old links must survive).
- [ ] The Data tab looks exactly as the old dashboard did, with **one** page heading, not two.

_Known and deliberate: the top-nav "Explore" item stops highlighting while you are on the Data tab. This is
pre-existing site-wide behaviour — "Playlists" already fails to highlight on `/playlist/:id` — not something
this branch introduced._

## 2. The map

- [ ] Roughly **640 dots** render.
- [ ] The four space chips — **Semantic · Thematic · Sound · Holistic** — each visibly re-lay-out the plot.
      (They are genuinely different projections; if two look identical, that is a finding.)
- [ ] The **Colour by** menu recolours the dots, and the legend changes with it.
- [ ] The legend's counts **sum to 640**.
- [ ] The line under the plot reads **"Showing 640 of 1,333 songs — only songs the analysis has mapped
      appear here."**

## 3. Interaction

- [ ] **Hover** a dot: a card appears with title, artist · year, and the current colour-by value. It follows
      the cursor and never sits underneath it.
- [ ] The hover card's third line **changes** when you change Colour by.
- [ ] **Click** a dot: it takes a ring, and its card fills the right rail with cover art and a
      **View song →** link. **The page must NOT navigate on the click itself** — this was your call, and it
      is the single most important behaviour on this page.
- [ ] Press **View song →**, then the browser **Back** button: you should land on **the same map** — same
      space, same colour, same spotlight, same selected song — not a reset one.
- [ ] Click **two legend entries**: everything else dims. Click them again: everything restores.
- [ ] Type in **Find a song**: non-matching dots dim, and matches list underneath. Clicking a match selects
      that dot and fills the same rail card.
- [ ] Changing **Colour by** while a spotlight is active **clears the spotlight** (its codes belong to the
      old dimension).
- [ ] **Copy the URL into a new tab**: the same view comes back. This is what makes a view shareable.

## 4. Judgement calls — the things no test can answer

These are the reason this checklist exists. Please answer them even if everything above passes.

- [ ] **Dot size and density at 640 points.** Do the clusters read as structure, or as mush? This is the
      one thing a headless browser cannot tell me.
- [ ] **Is "Other genres" honest at a glance?** The genre legend folds to metal · hardcore · punk ·
      Other genres · Not coded, because parent genre has 13 values and the palette has 5 slots. Does the
      fold feel like a fair summary, or like it is hiding the catalogue?
- [ ] **Does the coverage line read as an honest limit, or as broken?** It says the map shows just under
      half the live catalogue. If it reads as a bug rather than a fact, the wording needs work.
- [ ] **Are the four colours distinguishable to you at actual dot size?** They were chosen with a contrast
      validator (one of only 2 of 70 possible four-hue sets that pass in both light and dark), but the
      validator does not have your eyes.
- [ ] **Do the four spaces mean anything to you?** Semantic and Thematic in particular — if their layouts
      look interchangeable, that is worth knowing before we build 3D on top of them.

## 5. If something is wrong

Note which numbered item, and what you saw versus what the list says. Anything in §4 or §6.4 is a design
answer, not a bug — say what you would rather have.

---

## 6. The song page — "You might also like" (Tasks 8–11, built 2026-07-27)

The old block picked songs by genre-or-similar-energy with a `RANDOM()` tiebreak. Half that query was
dead: `songs.energy` is NULL across the whole catalogue, so the audio half never matched anything. It is
replaced by two embedding tabs, with an honest fallback for songs that have no embeddings.

**Three songs to open — these are the three coverage cases, verified working headlessly:**

- [ ] **`/song/1`** (_Some of My Best Friends Are Meat Eaters_) — **both embeddings.** Two tabs,
      **Similar message** and **Similar sound**, 6 cards each. Switching tabs is instant and makes **no
      network request** (both sets arrive in one response).
- [ ] **`/song/5266`** (_You Feed My Hate_) — **lyric embedding only.** Exactly **one** tab, no
      "More in this genre" line. A tab is omitted rather than shown empty.
- [ ] **`/song/4`** (_Show Some Heart (Go Vegan)_) — **no embeddings.** No tabs; the line
      **"More in this genre"** above a normal 6-card grid.
- [ ] Cards look **exactly as they did before** and still navigate on click — the markup is unchanged.

### 6.4 Judgement calls on the song page

- [ ] **Are the recommendations any good?** This is the whole question. "Similar message" is cosine over
      the 768-dim lyric embedding; "Similar sound" is distance over the 6-dim audio embedding **after
      per-dimension standardisation**. Do the two tabs give **visibly different** answers, and does each
      one earn its name?
- [ ] **Bear in mind you already found the acoustic derivation unreliable** (235 BPM coded
      `FREEFORM_ATMOSPHERIC`, NOFX coded `SOFT_CALM_ACOUSTIC`; your hypothesis was that the pipeline
      judges only the first ~30 seconds). **Similar sound reads the same underlying audio features**, so
      if that tab looks wrong, the likely cause is upstream in the pipeline, not in this code — a
      corrected re-run needs no code change here.
- [ ] **Is "More in this genre" honest enough**, or does it read as a consolation prize? It fires for
      **692 of 1,333 live songs (52%)** — not an edge case.
- [ ] **No similarity score is shown anywhere.** That was your call (a cosine value looks like a
      measurement a visitor can act on, and is not one). Still right?

---

---

## 7. Round two — what changed after your smoke (2026-08-03)

Your §1–§3 and §6 answers all passed, so nothing there was touched. These are the §4 answers, plus the
fixes a final whole-branch review found. **Only this section needs re-smoking.**

### 7.1 What you asked for

- [ ] **Semantic is gone.** Three chips: **Thematic · Sound · Holistic**, opening on Thematic.
      A link you saved earlier carrying `space=semantic` must fall back to Thematic, not draw an empty plot.
- [ ] **Each space now says what it is.** One quiet line under the toolbar that changes with the chip:
      lyrics / acoustic properties / both.
- [ ] **Dots are bigger** (radius 3.2 → 4).
- [ ] **The coverage line is smaller and greyer**, matched to the new space line beneath the plot.
- [ ] **Colour by → Genre names every genre.** Metal · Hardcore · Punk have their own colours; the rest are
      **indented under "Other genres"**, sharing its colour, each with a count and **each individually
      clickable**. Click **Soul (1)** — the map should dim to a single lit dot. Counts still total **640**.
- [ ] Clicking *some* members of the group leaves the group heading in a **third, in-between state** — it
      must not look identical to "nothing selected".

### 7.2 Why genre isn't eleven separate colours

You asked for a palette that works, with shades if needed. **It was measured and isn't possible.** Against
the contrast validator at scatter rigor, the worst pair scores 19.3 at four colours (passes), **9.8 at
five, 7.1 at eight** — against a floor of 15, below which colours are hard to tell apart *even with full
colour vision*. Shades are worse than hues. So the legend gives you every genre by **name and click**,
which has no such ceiling, while colour stays at the four that are honest. If the small genres still feel
buried, say so — the next lever is making a spotlit genre louder, not adding colours.

### 7.3 Fixes from the final review — quick checks

- [ ] Type nonsense (**"zzzz"**) into *Find a song*. The map must stay **normal**, with a "No songs match"
      line. Previously every dot went grey, which looked broken.
- [ ] Hover a dot near the **bottom edge** — the card must stay inside the plot.
- [ ] With >20 search results, the list says **"Showing 20 of N"** rather than silently truncating.
- [ ] On a song page, click a card in "You might also like" — the new song's recommendations must not
      briefly show the **previous** song's six.

### 7.4 One correction you should know about

I told you during the smoke that genre was **59% uncoded** on the map. **That was wrong** — I measured the
raw `songs.genre` column instead of the effective genre the map actually uses. The real figure is **13.9%**,
and the top three genres cover **75.6%**. Genre is a well-populated colour dimension. No design changed as
a result, but the "genre is mostly empty" reasoning is withdrawn.

---

## What is left

Nothing in the plan — all 12 tasks plus the post-smoke Batch A are built. **Batch B is specced and waiting
as its own session:** zoom/pan with the viewport in the URL, hover growth and a tweened space switch, and
the narrow-width layout with the legend above and the song card as a bottom sheet.

Deliberate follow-ups, not omissions: **3D is its own future session** (2D needs no charting dependency;
3D adds ~150KB of WebGL plus raycast hit-testing), and the **acoustic derivation re-run** is a pipeline
matter you already know about.
