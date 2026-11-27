# Artist Enrichment Data: Critical Review (main project to analysis project)

**Date:** 2026-11-27
**Reviewed:** the live `artist_enrichment_proposals` table in `vegan_playlist` (803 rows, all `review_status = 'PENDING'`, written on 2026-11-26 in two run days), read-only, against the handoff `docs/MAIN_PROJECT_ARTIST_ENRICHMENT_HANDOFF.md`.
**Purpose:** tell the analysis project what is solid, what is not, and what to change so the next run is more reliable, robust and auditable. Nothing here changes the Option A invariant (the analysis project never writes `artists` / `artist_members`); every finding is about what the analysis project stages.

---

## 1. Verdict in one paragraph

The pipeline's structure is good, and the deterministic tiers are strong: the exact-ID MusicBrainz and Wikidata facts look trustworthy, nothing was written outside the staging table, and every proposed vegan note has a quoted snippet. But three things stop the data being safely approvable at scale. **(1)** The advocacy stance labels sometimes claim more than the evidence they cite (vegetarian is filed as vegan). **(2)** The audit trail is thinner than it looks: several audit fields do not work, 89% of evidence links are opaque redirects, and facts carry one confidence label with no way to tell a corroborated fact from a single model guess. **(3)** The sources are never reconciled with each other or with our own catalogue, so contradictions are staged as if they were facts. None of this needs a new approach; it needs a validation and provenance layer between "the model said it" and "the row says it".

The headline coverage figures in the handoff are accurate (I reproduced every one). But "100% coverage" is partly manufactured by fallbacks (see F3.3), so coverage should not be read as reliability.

---

## 2. What is good and should be kept

These were checked and held up:

- **Counts match the handoff exactly** (803 staged / 644 published; 422 MBIDs; 766 countries; 798 first and last years; 793 bios; 551 notes; 611 member lists; 2,827 member rows).
- **The provenance invariant holds.** Nothing in `artists` or `artist_members` came from the pipeline.
- **No vegan note is without evidence.** All 551 notes have at least one snippet; no note lacks a URL.
- **Hedging is rare** (10 of 551 notes use "may / reportedly / appears"), and no bio or note contains boilerplate ("as an AI", "no information") or citation junk (`[1]`).
- **Internally consistent in one direction:** no `UNVERIFIED` artist has a member flagged `vegan = true`.
- **No duplicate member names within one artist**, and no placeholder member names.
- **The model does not default to US/UK.** Its MEDIUM-confidence country spread (US 94, UK 93, then SE/DE/AU) resembles the MusicBrainz/Wikidata baseline (US 148, UK 101, DE 18).
- **Exact-ID sources are clean.** `WIKIDATA_P1902` shows 1 of 125 first-release contradictions against our catalogue (0.8%); `EXISTING` shows 0 of 3.
- **Curated data was protected.** One proposal conflicted with a stored value (id 10, xTrue Naturex: stored "USA", proposed "United States") and it is only a spelling difference.

---

## 3. Findings, most serious first

### F1. Stance labels overreach their own evidence (vegetarian is filed as vegan)

**What:** `EXPLICIT_VEGAN_BAND` and `VEGAN_MEMBERS` are applied where the cited evidence says *vegetarian*, or explicitly says *not vegan*.

Examples, with the evidence the row itself carries:

| id | artist | stance / confidence | what the evidence actually says |
|---|---|---|---|
| 227 | Cattle Decapitation | `VEGAN_MEMBERS` / HIGH | Snippet: "just Josh and I are what you would call 'vegetarian'... the entire media world thinks we are hardline vegan... we're just not." The members list marks nobody `vegan: true` (two members `false`). The stance contradicts its own snippet *and* its own members list. |
| 95 | Bikini Kill | `VEGAN_MEMBERS` / MEDIUM | Note: "not a vegan band"; snippet: "I am still a vegetarian, and I try to be a vegan, but I occasionally cheat." Kathleen Hanna is still flagged `vegan: true`. |
| 34 | Paul McCartney | `VEGAN_MEMBERS` / HIGH | Vegetarian since 1975, animal-rights advocate. |
| 68, 286, 1373, 13, 32, 459, 499, 3645, 3682, 3552 | Laura Nyro, Siouxsie and the Banshees, Yes, Citizen Fish, Melanie Safka, Travis Ryan, Lost Cherrees, Der W, Jens Friebe, Linda McCartney | `VEGAN_MEMBERS` or `EXPLICIT_VEGAN_BAND`, HIGH | Evidence describes vegetarianism and/or animal-rights advocacy, not veganism. |

**Scale:** a crude keyword filter (evidence says "vegetarian" and never "vegan", or negates "vegan") flags **28 rows** labelled vegan (22 at HIGH, 6 at MEDIUM). I read the first 20 of the 28. About 12 are real mislabels (the ids above); the remainder are filter false positives (for example 3614 Cenizas, 354 Homeboy Sandman and 3691 Megadeth, whose evidence does support a vegan claim). Treat 28 as a lower bound on rows needing a look, not a measured error rate.

**Why it matters:** the site's central claim is vegan music. A "HIGH confidence vegan members" label on a band whose members publicly say they are not vegan is the most damaging error type, and it is exactly the error a curator skimming a green pill will miss.

**Recommended changes:**
1. Split the taxonomy. Add a distinct class for vegetarian and animal-rights advocacy (for example `VEGETARIAN_OR_ANIMAL_RIGHTS`), so these artists are findable and not forced into "vegan".
2. Require a deterministic post-check: a vegan stance or `vegan: true` flag is only allowed if at least one quoted snippet contains the word "vegan" (or an agreed synonym list) attached to the right subject (the band, or that member). Otherwise demote or raise a flag.
3. Cross-check stance against the artist's own members list (Cattle Decapitation case) and fail the row on contradiction.
4. Confidence must be derived from the evidence (see F2.4), not self-reported.

### F2. The audit trail is thinner than it appears

**F2.1 Audit fields that do not work.** `layer4_search_queries` is `0` on **587 of the 589 rows that have grounded search URLs** (model `gemini-4-hydrogen`, 788 rows; only 2 rows record any queries). The field cannot be used to audit whether search ran or how many queries produced a claim.

**F2.2 Evidence links are opaque.** 1,315 of 1,475 evidence snippets (89%) point to `vertexaisearch.cloud.google.com/grounding-api-redirect/...` links. A human cannot tell where one leads without following it, and such links may expire or be session-bound. **168 of the 266 `EXPLICIT_VEGAN_BAND` / HIGH rows (63%) have only redirect URLs.** Only 128 evidence URLs are Wikipedia. Recommend resolving each redirect to its final URL at collection time and storing the final URL, the page title and the retrieval timestamp.

**F2.3 Facts and bios with no evidence at all.** Model-sourced values with no evidence URL on the row: **70 countries** (of 372), **56 first-release years** (of 261) and **104 bios** (of 793). These are answers from model memory, not search results, and nothing distinguishes them from grounded ones.

**F2.4 Confidence is one label per field and is not calibrated.** Every Gemini fact is `MEDIUM`; every MusicBrainz title-verified match is `HIGH`. A single uncorroborated model answer and a fact agreed by two independent sources cannot be told apart, and `MB_TITLE_VERIFIED` / `HIGH` includes rows that contradict our catalogue (F3.1). Recommend a rule-derived scale, for example: two independent agreeing sources = HIGH; exact-ID single source = HIGH; single LLM answer = at most MEDIUM; any contradiction = CONFLICT (and not staged as a normal proposal).

**F2.5 Attribution is per row, not per claim.** A member row says `source: MusicBrainz` but carries `vegan: true` with an evidence note; MusicBrainz cannot make a vegan claim, so the label vouches for the name while the vegan claim came from Layer 4 (examples: The Smiths' Johnny Marr and Morrissey; 120 vegan flags are attributed to MusicBrainz). The same applies to a bio, which blends several sources under one `bio_source`. Provenance should attach to each attribute (name, tenure, vegan flag), not the row.

**F2.6 Reproducibility.** There is no run id, prompt or prompt hash, model parameters, raw response, or retrieval timestamp. Only `updated_at` (two run days) and `layer4_model` are recorded; 15 rows come from a different model (`gemini-3.8-flash`) from the other 788, and nothing on the row says whether that matters. The proposals are written by upsert, so a re-run overwrites with no history. `reviewed_at` is unused.

**F2.7 (ERRATUM, 2026-11-27: this finding was wrong and is withdrawn).** I reported `artist_enrichment_review` as an undocumented table. It is the main project's own web-owned review-state table (migration on branch `session-enrichment-review`, spec `docs/superpowers/specs/2026-11-23-artist-enrichment-design.md`), not the analysis project's. The analysis project does not need to document or own it.

### F3. Sources are not reconciled with each other or with our catalogue

Our catalogue holds the albums and songs for these artists (`songs`, `albums.release_date`, which is Spotify's date). Comparing MusicBrainz release years with the earliest and latest album year we hold:

**F3.1 Contradictions staged as facts: 56 artists.**
- **20** have a proposed *first* release year later than an album we hold (all from MusicBrainz).
- **36** have a proposed *last* release year earlier than an album we hold (36 MusicBrainz, 1 Gemini: id 3844 Fall Of Efrafa, 2009 vs our 2021).
- The rate depends on how the MBID was found: first-year contradictions are **12 of 149 (8.1%)** for `MB_TITLE_VERIFIED`, **7 of 127 (5.5%)** for `MB_SPOTIFY_URL`, **1 of 125 (0.8%)** for `WIKIDATA_P1902`. Last-year contradictions: 23 `MB_TITLE_VERIFIED`, 9 `MB_SPOTIFY_URL`, 4 `WIKIDATA_P1902`. Title-verified matches are the weakest identity path, yet they are labelled HIGH and also feed country (129 rows), release years (149) and members (133).
- Caveat that cuts both ways: a contradiction does not prove MusicBrainz is wrong. Spotify's album date can be a reissue date (id 163 Icons Of Filth: MB first release 1983 vs our album date 1977, which looks like the bad one). But some gaps are large and look like a wrong identity: id 1664 ManLiftingBanner (MB first release 2014, our album 1995, Gemini bio says formed 1990, and the MusicBrainz and Gemini member names differ: "Paul van de Berg" vs "Paul van der Berg"), id 3954 Ripcord (last 1988 vs our 2016), id 3570 Abattoir (1986 vs 2021), id 24396 Unborn (1997 vs 2022), id 95 Bikini Kill (1996 vs 2014).
- **Recommendation:** run the catalogue comparison inside the pipeline and emit a `CONFLICT` flag with both values. The curator then decides; the row is not offered as a normal proposal.

**F3.2 No plausibility guards.** `proposed_last_release_year = 2027` for id 1596 Fear Factory and id 39364 Julien Baker (MusicBrainz future-dated entries). Cap at the current year and drop pre-release announcements. (The other extreme values, 1941 Pete Seeger and 1950 Flanagan & Allen, are plausible.)

**F3.3 Coverage is partly manufactured by a fallback.** "100% first and last release year" depends on the `Catalogue Albums` source (212 rows; 133 first-year and 151 last-year values are *exactly* our own earliest/latest album year). That is our own data presented back as an external fact: it is a floor/ceiling ("earliest/latest we hold"), not the band's first/last release. It should be a different field (or flagged `DERIVED_FROM_CATALOGUE`), and counted separately in coverage reporting. For the same reason the comparison in F3.1 is blind to those 212 rows.

**F3.4 Bio and fact fields are generated independently and never checked against each other.** Bio says formed in a year 15+ years from the first release year: id 3625 Culture Shock (bio 1986 vs MB first release 2004), id 1664 ManLiftingBanner (1990 vs 2014), id 24400 Lunatic Fringe (2013 vs 1982), id 295 Man Must Die (2024 vs 2004). Some are legitimate (a reformation, a late first record); some will be wrong identity. A reconcile step should flag them.

### F4. Identity: duplicates, collisions and fixtures in the staged set

- **Three MusicBrainz IDs are assigned to two artists each:** `b3d3cfd8-6930-46ec-b475-112b44b49e1f` (129 Tena Stelin / 208 Tenastelin), `c229c92b-2e42-42b8-8dd0-015952e706b0` (3777 The Instigators / 3878 Instigators), `c8c3beb5-d213-40e6-9ef6-d4e1cad59e12` (32 Melanie Safka / 3896 Melanie). These are duplicate *artist records* in our database (the staging pairs agree with each other), but the pipeline should have reported "two artists, one MBID" as a collision, not silently proposed the same identity twice.
- **Further duplicate pairs by name** (same name after folding case, "The" and punctuation): 260/271 TK The Artist, 4056/24407 Zero Again, 3986/24397 Steve White & The Protest Family (proposals differ: first year 2010 vs 2012), 4064/24419 xDELIVERANCEx (last year 2024 vs 2022), 10544/24388 Bobby Bastard and the Blackwater Blues Explosion. Same-named artists got *different* facts, which is a symptom the pipeline should surface.
- **Test fixtures were staged:** five `ZZZWB...` test artists (ids 4785, 4786, 4787, 4788, 4849) have rows. They carry no data, but they show the eligibility query lacks an exclusion for fixture names.
- **`MB_TITLE_VERIFIED` is "HIGH" but its method is not recorded.** Store *what matched* (the song title, the MusicBrainz recording id, the artist-credit string) so a curator can confirm the identity in one glance.

### F5. Members: normalisation, tenure and semantics

- **Same person, different spellings:** 8 names contain a Unicode hyphen (U+2010, from MusicBrainz) where the Gemini name uses ASCII `-` (id 222/223 Alissa White-Gluz, id 355 Ambrose Kenny-Smith, id 64 James Honeyman-Scott); 8 contain curly quotes; 37 carry a quoted nickname inside the name (`Chris "Motionless" Cerulli`, `Kevin "Pacsun" Kaine`). A crude cross-source match finds 21 near-duplicate pairs across 10 artists, and 78 artists have members from both sources. Partial names appear too ("Willem" vs "Willem Heijmans", id 1). Canonicalise names to a key (fold case, diacritics, dash and quote variants, strip quoted nicknames into an `aliases` field) before merging sources.
- **No tenure.** Different eras show as different people (id 294, id 200 "Chris Rybicki" vs "Chris O'Toole", id 227 "Dave Astor" vs "Dave McGraw"). `is_current` alone cannot express "was in the band 1998-2004". Add start/end years where known.
- **Solo artists carry member lists.** 44 `Person`-type artists have a member list, mostly themselves (id 459 Travis Ryan, id 34 Paul McCartney, id 96 Bo Burnham). A person is not a band; either leave `proposed_members` null or store the legal/birth name as an alias.
- **`artist_type` is null for 398 of 803 rows (50%)**, so it cannot yet be relied on to make the solo/group decision.
- **Three vegan flags have no evidence note** (id 83 To The Grave: Raymond Martin, Jack Simioni, Nic Webb). A `vegan: true` with no note should be impossible.
- **Stance vs members:** see F1 (id 227 has stance `VEGAN_MEMBERS` / HIGH and no `vegan: true` member). A consistency check should run both ways.

### F6. Smaller data points

- **Country semantics are undefined.** Is it country of origin, formation, or current base? Bios show cases that differ (id 3563 Steve Poltz: MusicBrainz "United States", bio "born in Halifax, Nova Scotia, raised in San Diego"; id 3964 Sect, an American-Canadian band). Please state the rule and apply it.
- **Odd country values:** `East Germany` (id 3651 Dritte Wahl, from Wikidata; a defunct state, so map to the present-day country or flag it), `Myanmar (Burma)` (id 4011 The Rebel Riot, MusicBrainz; looks suspect), `Guyana` (id 342 Donna Makeda, Gemini; check), `Türkiye` (matches our formatter's `Intl.DisplayNames` output, fine). Our stored curator value `USA` (id 10) was not normalised, which is our side to fix.
- **One non-band website:** id 263 Boogie Down Productions, `proposed_website_url` is a MySpace page. All 203 proposed Bandcamp URLs are `bandcamp.com`, and none of the 210 websites is a Bandcamp URL (good: that was a past mistake of ours).
- **`UNVERIFIED` conflates "not searched" with "searched and found nothing".** 202 rows, all LOW or HIGH-but-empty. The catalogue itself is evidence the pipeline does not use: ids 320 FranCisco ("Vegang"), 59 Kenny Davis ("The Vegan Song"), 3678 Ghosthost Vigilante ("I Am a Vegan") are UNVERIFIED while their songs in our catalogue are vegan-titled, and our own lyric analysis (`song_lyric_analysis.advocacy`, `themes`, `topics`) already codes advocacy for many songs. Use it as an input, or at least a cross-check.
- **Straight edge is not vegan.** 14 `UNVERIFIED` bios mention straight edge or similar. That is correct as UNVERIFIED, but a `STRAIGHT_EDGE` note may help the curator, since many of these bands are vegan.
- **Stale rows.** id 281 Barbara Helen was edited by the curator after her proposal was written; a staged row should record the `artists.updated_at` it was built against so staleness is visible.

---

## 4. Recommended changes, in priority order

**P0: before a curator can safely bulk-approve anything**

1. Fix the stance/evidence contract (F1): separate vegetarian from vegan, require the word in a quoted snippet attached to the right subject, cross-check stance against members.
2. Add a `CONFLICT` status and a catalogue/cross-source reconciliation step (F3.1, F3.2, F3.4): contradictions are flagged with both values and are not offered as ordinary proposals. Add plausibility guards (year cap, first <= last).
3. Resolve and store final evidence URLs, page titles and retrieval timestamps (F2.2); fix `layer4_search_queries` (F2.1).
4. Report identity collisions and exclude fixtures (F4).

**P1: audit and robustness**

5. Derive confidence from rules, not from the model (F2.4); distinguish `NOT_SEARCHED` / `SEARCHED_NOTHING_FOUND` / `FOUND`.
6. Per-attribute provenance (F2.5) and a run record: run id, model, prompt hash, parameters, started/finished, raw response reference (F2.6). Keep history instead of overwriting.
7. Member canonicalisation, aliases, tenure, solo-artist rule, `artist_type` filled for every row (F5).
8. Record the `artists.updated_at` each proposal was built against (F6).

**P2: polish**

9. Define the country semantics and allow-list; handle historical states (F6).
10. Feed catalogue and lyric-analysis advocacy codes in as evidence for the stance (F6).
11. Report `Catalogue Albums` values as a separate "derived" field in coverage, not as a first/last release (F3.3).
12. (Withdrawn: see the F2.7 erratum.)

### How the main project will consume the data (so the pipeline can target it)

- **The curator reviews every artist** (a standing decision recorded in the enrichment spec: no bulk approve). The fast path is per artist: a fill-only "accept all shown, next artist", which will offer only values from exact-ID sources or HIGH confidence under the new rules with no `CONFLICT` flag, and only where the destination column on `artists` is empty. (An earlier draft of this paragraph described a bulk-approve lane; that was my mistake. Whether a bulk lane is ever added is the curator's call, not decided.)
- **Always an explicit per-field click:** anything MEDIUM, every bio, every vegan note, the stance, and every `vegan: true` member flag. Vegan member flags and stance will never be applied automatically, and `artist_members.vegan` stays curator-only whatever the staging row says.
- **What the curator needs to see per field:** the value, the source, the confidence, a clickable final URL, the quoted snippet, and any conflict flag with both values. Everything the pipeline cannot show in that shape is, in effect, unauditable to us.

---

## 5. How this review was done, and its limits

- Read-only SQL against the live table and the main project's `artists`, `songs`, `albums`, `song_artists`, `artist_members` tables on 2026-11-27. No facts were checked against the web; where I say a value "looks suspect" it is a plausibility judgement, not a verified error.
- Keyword and regex checks (stance vs evidence, bio vs year, name near-duplicates) are heuristics: they find candidates and have false positives; the counts are lower bounds on rows worth a look, not error rates. I read 6 notes/snippets in full and the first 20 of the 28 stance flags.
- The catalogue comparison uses Spotify album dates, which can be reissue dates, so a contradiction means "two sources disagree", not "MusicBrainz is wrong".

### Reproducing the main checks

```sql
-- earliest / latest album year we hold, per artist
-- (alias p = artist_enrichment_proposals)
(SELECT min(EXTRACT(YEAR FROM al.release_date))::int
   FROM song_artists sa JOIN songs s ON s.id = sa.song_id
   JOIN albums al ON al.id = s.album_id
  WHERE sa.artist_id = p.artist_id AND al.release_date IS NOT NULL)   -- ALB_MIN (use max() for ALB_MAX)

-- F3.1: first-release year later than an album we hold, by how the MBID was found
SELECT p.mbid_match_method, count(*) FILTER (WHERE p.proposed_first_release_year > ALB_MIN) AS contradictions,
       count(*) AS with_mb_years
  FROM artist_enrichment_proposals p WHERE p.first_release_source = 'MusicBrainz' GROUP BY 1;

-- F2.1: search counter vs grounded URLs
SELECT layer4_model, count(*) AS n,
       count(*) FILTER (WHERE COALESCE(layer4_search_queries,0) = 0
                          AND EXISTS (SELECT 1 FROM unnest(evidence_urls) u WHERE u LIKE '%vertexaisearch%')) AS zero_counter_but_grounded
  FROM artist_enrichment_proposals GROUP BY 1;

-- F2.2: share of snippets that are redirect links
SELECT count(*) AS snippets,
       count(*) FILTER (WHERE s->>'url' LIKE '%vertexaisearch%') AS redirect_urls
  FROM artist_enrichment_proposals p, jsonb_array_elements(p.evidence_snippets) s;

-- F1: vegan stance whose evidence says vegetarian and never vegan (crude)
WITH t AS (
  SELECT p.*, (COALESCE(p.proposed_vegan_notes,'') || ' ' ||
         COALESCE((SELECT string_agg((s->>'claim')||' '||(s->>'snippet'),' ')
                     FROM jsonb_array_elements(COALESCE(p.evidence_snippets,'[]'::jsonb)) s),'')) AS txt
    FROM artist_enrichment_proposals p)
SELECT artist_id, artist_vegan_stance, advocacy_confidence FROM t
 WHERE artist_vegan_stance IN ('EXPLICIT_VEGAN_BAND','VEGAN_MEMBERS')
   AND ((txt ~* 'vegetarian' AND txt !~* 'vegan')
        OR txt ~* '(not (a |an |strictly |entirely |all |fully )*vegan|mischaracteri[sz]ed|occasionally cheat|not strictly)');

-- F4: MBID collisions
SELECT proposed_musicbrainz_id, array_agg(artist_id) FROM artist_enrichment_proposals
 WHERE proposed_musicbrainz_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```
