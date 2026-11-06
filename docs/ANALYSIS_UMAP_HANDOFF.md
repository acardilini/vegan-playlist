# Hand-off note: tighter clusters for the Explore map

For the separate analysis project that writes `song_coordinates`. The website only reads these
columns; it does not compute or alter coordinates.

## What the site reads

`song_coordinates` has one row per song and eight `float8[]` columns, `{space}_2d` and `{space}_3d`
for each of `semantic`, `thematic`, `audio`, `holistic`. Any space with a `*_2d` column appears on the
map automatically (a `*_3d` sibling enables the 3D view for that space). `semantic` is currently hidden
on the site. The site normalises each 3D cloud itself (centre on the bounding-box midpoint, one uniform
scale), so the pipeline does **not** need to rescale the 3D output.

## Settings that made a pilot's clusters read better

- **Fit 2D and 3D separately.** Run UMAP once with `n_components=2` and once with `n_components=3` for
  every space. Do not lift a 2D layout into 3D by adding a flat third axis; the 3D view then shows a flat
  sheet.
- **`min_dist = 0.15`** and **`n_neighbors` between 25 and 30.** The pilot moved away from larger
  defaults (for example `min_dist = 0.5`): small `min_dist` packs similar songs into dense, readable
  neighbourhoods while `n_neighbors` keeps the global genre structure.
- **Metric per space:**
  - thematic (about 175-D), semantic (768-D) and holistic (multimodal): `metric='cosine'`, so songs group
    by the direction of their profile (shared themes, frames, lyric embeddings) and not by vector length.
  - audio / Sound (6-D acoustic features): standardise each feature first (`StandardScaler`), then
    `metric='euclidean'`, so tempo, loudness and brightness all count.
- Keep `random_state` fixed so a re-run does not reshuffle the whole map between releases.

## Caveats

- 2D and 3D are separate fits, so a song's neighbours in 3D are not guaranteed to be its neighbours in 2D.
  The site treats each view on its own.
- Only songs with real lyrics and a visible analysis are plotted; the rest are excluded by the site.
