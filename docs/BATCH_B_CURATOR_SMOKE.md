# Batch B — Explore map interaction layer: curator smoke checklist

**Branch:** `session-B4-batch-b` · **Status:** all 5 code tasks built (Tasks 1–5), plus this task's
Puppeteer smoke. Everything below has passed automated checks (backend 165/165 — unchanged,
26 frontend module tests, lint 0 errors, build clean, and headless-browser runs 17/17) and been
reviewed statically, task by task. **None of it has been looked at by a human in a live browser.**
That is what this list is for.

No §0 restart step this time: your `:5000` backend is nodemon, and this batch touches **no backend
file at all** — it is pure frontend (`frontend/src/components/explore/`). Just make sure you're on
the branch; Vite reloads on its own.

```
git checkout session-B4-batch-b
```

---

## §1 Zoom and pan

- [ ] **Scroll the wheel** over the map, aimed at a cluster: the plot zooms **toward the cursor**
      (the cluster you were pointing at should stay roughly under the pointer, not slide away).
      Trackpad pinch works the same way (it arrives as a ctrl+wheel).
- [ ] **Drag** the map: it pans smoothly, and the cursor shows a "grabbing" hand while held.
- [ ] The **`+`** and **`−`** buttons zoom in and out around the centre of the plot.
- [ ] **Reset** returns to the exact starting fit-to-plot view.
- [ ] Zoom all the way in with `+`. **Does 12× feel like enough**, or does the plot run out of
      useful structure well before you get there?
- [ ] Zoom all the way out with `−`. **Does 1× (fit-to-plot) feel like the right floor** — is there
      ever a moment you'd want to zoom out further than "everything fits"?

## §2 The URL

- [ ] Zoom and pan to some arbitrary view, then **copy the URL and open it in a new tab.** The new
      tab should show the same view — same zoom level, same pan position. (A sub-pixel difference is
      possible and expected — the URL rounds the pan to the nearest whole pixel and the zoom to two
      decimal places so links stay short — but nothing you can see with your own eyes should look
      different.)
- [ ] **Hand-edit the `view` query parameter to nonsense** (e.g. change it to `view=banana` or delete
      part of it) and load that URL. The map must still draw at the normal fit-to-plot view, **not** a
      blank or broken plot.
- [ ] Zoom in, then click **Reset**. The `view` parameter should disappear from the URL entirely (an
      unzoomed map shares as a clean link).

## §3 Drag versus click

- [ ] **Click** a dot without moving the mouse: it selects that song (ring on the map, card fills
      the rail).
- [ ] **Drag** across the map (a real click-and-hold-and-move, not just a click): when you release,
      **no song should be selected** — panning must never be mistaken for a click, even if the drag
      ends on top of a dot.
- [ ] Try a very short, deliberate drag (just a few pixels) — confirm it's treated as a pan, not a
      click, and does not select whatever dot happens to be under the release point.

## §4 Motion

- [ ] Switch between the space chips (**Thematic → Sound**, then back, then try **Holistic** too)
      and actually watch the transition, not just the end state. **Does the tween show you which
      songs travel together between the two layouts?** That is the question no automated test can
      answer, and the entire reason this animation was built — if it just looks like the dots
      "jump" or the motion is too fast/slow to read, say so.
- [ ] Switch spaces again **while a previous switch is still animating** (click a different chip
      mid-tween). The motion should resume smoothly from wherever the dots currently are — it
      should not visibly jump or restart from the old space's final positions.
- [ ] Hover a dot: it should visibly grow a little and gain a soft halo in its own colour, making it
      easy to tell which one you're pointing at.
- [ ] If your OS/browser has **"reduce motion"** turned on (macOS: System Settings → Accessibility →
      Display → Reduce motion; Windows: Settings → Accessibility → Visual effects → Animation
      effects off), switching spaces should **snap instantly** with no tween at all.

## §5 Narrow layout

- [ ] Shrink your browser window to roughly phone/small-tablet width (below ~860px). The **colour
      legend should move above the map** (not beside it), and the **map should take the full
      width**.
- [ ] The legend swatches should read as a **wrapped strip** with each colour's label and count
      still attached — not a single column stacked one entry per line, and not truncated text with
      no label.
- [ ] Select a song at this width: its card should appear as a **bottom sheet** docked to the
      bottom of the screen, **capped at roughly 30% of the viewport height** — it should not grow
      tall enough to cover most of the map.
- [ ] **Does the sheet cover the dots you just clicked** badly enough to matter — i.e. can you still
      see enough of the map around/above the sheet to click a *different* dot without dismissing the
      first selection?
- [ ] Resize back up past 860px and confirm the layout returns to the normal side-by-side rail —
      nothing should look stuck in the narrow arrangement.

## §6 Regressions — things this batch should not have touched

- [ ] Click two entries in the colour legend (spotlight): everything else on the map dims, and
      clicking them again restores it — same as before this batch.
- [ ] Type in **Find a song**: the matching dots stay lit, the rest dim, and the result list under
      the search box still works.
- [ ] Select a dot, then press the **×** on its rail/sheet card, and separately press **Escape**:
      both should clear the selection and remove the ring from the map.
- [ ] Visit `/dashboard` directly: it should still redirect you to `/explore/data`.

## If something is wrong

Note which numbered item, and what you saw versus what the list says. §1 and §4's judgement
questions are design answers, not bugs — say what you'd rather have instead.

---

## What is left

Nothing in the plan for the Explore map — Batch A and Batch B both built and smoked (this smoke
still needs your pass before merge). Deliberately deferred, not omitted: **real touchscreen pinch**
(the wheel/drag/button controls cover mouse and trackpad; a dedicated touch gesture was scoped out
of this batch) and **3D**, which remains its own future session.

**Next session after this merges: triage 6 — the About page's analysis-explainer + AI-disclosure
content** (the metadata-component and thematic-dimension descriptions the API already serves but
browse deliberately doesn't show).
