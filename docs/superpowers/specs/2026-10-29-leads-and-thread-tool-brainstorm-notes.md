# Leads list, vegan-member info and Reddit thread tool - brainstorm notes

Date: 2026-10-29. Status: **brainstorm in progress, NOT an approved design.** No code built. Next step: resume the brainstorm (see "Open" below), then write a spec for piece 1 and get the curator's approval before any plan or code. Tool 1 of the original request (Playlist cross-check) is built and merged; this is tool 2, which grew.

## What the curator wants

When a Reddit thread asks for vegan music, the replies hold great suggestions, but reading the thread, collating the suggestions and cross-checking them against the playlist is very laborious. They also come across promising bands elsewhere and have nowhere to save "look into this band". Both serve building out the playlist.

The example thread (curator pasted the full page text; not stored here): `https://www.reddit.com/r/vegan/comments/1xfajh5/` ("Vegans in music", r/vegan, ~700 comments). Patterns seen in it:
- Most replies are **bands named with no song** (Earth Crisis, To The Grave, World of Pleasure...). A few name a specific song ("Fishing for Fishies", "Chicken Squawk").
- Many replies are **claims about whether a person or specific band members are vegan** ("Joe Duplantier of Gojira", "Tommy and Paul of Between the Buried and Me", "all members of Avatar"), often with a genre because the thread's OP asked for genre + vegan member(s).
- Many claims are **disputed or retracted** in-thread (Cattle Decapitation, Billie Eilish, Oli Sykes, King Gizzard, Ariana Grande, Paul McCartney = vegetarian). Statuses seen: vegan, vegetarian, formerly vegan, not vegan, unsure.
- Replies also include artists plugging their own music, jokes, and off-topic argument; ads, usernames, vote counts and "Reply / Share" chrome surround everything.

## Decisions so far (curator's, unless marked as my guess)

- **The extraction must be free** (curator: "I would prefer it to be free"; consistent with the existing "no paid services" rule). So no in-app LLM call. The LLM step is **Claude in a Claude Code session**, packaged as a repeatable skill.
- **Input is pasted thread text.** Reddit returned 403 to a direct `curl` of the thread JSON from this machine and old.reddit redirected without content. The curator accepted pasting, understanding the text is noisy (ads, usernames, vote counts); an LLM ignores that. Very long threads are pasted in chunks. A Claude-in-Chrome read of the logged-in browser is a possible later shortcut (the extension was not connected this session).
- **Approach approved ("This sounds like a good approach")**: each mention becomes a record (artist, named song if any, which members are said to be vegan, a status, genre if given, the supporting quote, link to the thread); repeats merged; claims are **unconfirmed leads** (disputed ones recorded too, with the dispute) and nothing is public until the curator confirms.
- **A Leads list is wanted** ("a leads list is a great idea"): somewhere to save a band worth looking into, from a thread or typed by hand. Fields (my default shape): band name, source (thread link or the curator's own note), genre, vegan-member claims with quote, status **To look into / Checked / Dismissed**. **Promote** a lead = create the artist and open its workbench, where Spotify/Bandcamp/MusicBrainz identity and the Catalogue (Band check) are set as today. **Dismissed leads are remembered** so the same band is not offered again.
- **Band check already exists** but only per existing artist (Artists workbench > Catalogue tab, sub-projects H/I1/I2); the standalone Songs > Band check view was retired in I1. The curator did not know that; the Leads list fills the "band I have only heard of" gap and feeds it.
- **Named songs** go through the Playlist cross-check table (resolve to a Spotify track, then New / Possible duplicate / Already have it, Import / Reject / Add lyrics), imports tagged by a new origin (e.g. "From Reddit thread").
- **Vegan-member information on artists** (my default shape, curator invited correction): a status (vegan band / has vegan member(s) / not vegan / unknown), a free-text note naming members, a source link, and a **confirmed** tick. The curator said such information would be good on the **artist information pages**.

## Order agreed (the curator was asked to confirm; they ended the session before answering)

1. **Leads list + vegan information on artists** (backend + admin UI; a Leads queue in the Artists area; the artist workbench gets a vegan-information section). Needs its own spec.
2. **The thread tool** (Claude Code skill that extracts leads / claims / named songs from pasted text and loads them into Leads and the cross-check table).
3. **Public display** of confirmed vegan-member information on the public artist page (small; only after the data exists).

## Open for next session

- Confirm the order above and the vegan-information shape.
- Where a lead's vegan claims live before promotion (on the lead record), and what is copied to the artist on promotion.
- How the skill hands results to the app (it runs with direct DB access like the scratchpad scripts, so a script that takes extracted JSON and writes leads is the likely route; never use the admin password in a browser).
- Whether leads match existing artists by name (850 artists) and show "already an artist" instead of a new lead (likely yes, normalised-name match, no stamping of identity - see the cross-check review finding about name-merging).
- Public wording policy for "vegan" claims about real people (confirmed + source link only; never publish "not vegan" claims).
- A real run on the example thread as the first test of piece 2.
