# B4 — Explore map: curator smoke checklist

**Branch:** `session-B4-explore-map` (8 commits from `3f479c7`) · **Status:** map half built and reviewed,
**held for this smoke before the second half is built**.
Plan: [`superpowers/plans/2026-07-27-B4-explore-vector-map.md`](./superpowers/plans/2026-07-27-B4-explore-vector-map.md) ·
Spec: [`superpowers/specs/2026-07-27-B4-explore-vector-map-design.md`](./superpowers/specs/2026-07-27-B4-explore-vector-map-design.md)

Everything below has passed automated checks (backend 159/159, lint 0 errors, build clean, and headless
browser runs). **None of it has been looked at by a human.** That is what this list is for — and the items
under §4 are the ones no test can answer.

---

## 0. Before you start — RESTART THE BACKEND

Your `:5000` backend is a plain `node server.js` started **before this branch existed**, so it is running
old code and does not have `/api/analysis/explore/points`. **`/explore` will show its error state until you
restart it.** Vite on `:5173` picks up frontend changes by itself; the backend does **not** reload.

```
git checkout session-B4-explore-map      # if not already on it
# stop your :5000 backend, then:
cd backend && npm run dev
```

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

Note which numbered item, and what you saw versus what the list says. Anything in §4 is a design answer,
not a bug — say what you would rather have.

---

## What has NOT been built yet (Tasks 8–12)

Deliberately stopped before these, because they touch the song page:

- The two similarity tabs on the song page — **Similar message** (cosine over the 768-dim lyric embedding)
  and **Similar sound** (z-scored distance over the 6-dim audio embedding).
- The **"More in this genre"** fallback for the **693 of 1,333 live songs (52%)** that have no embeddings.
- Deleting the superseded `frontend/public/vector_space.json`.
- The documentation pass (`CLAUDE.md`, `PRD.md` §11, and correcting the spec's payload-size estimate).

Nothing on the song page has changed yet, so it is unaffected by this branch.
