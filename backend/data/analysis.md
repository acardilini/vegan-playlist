Every song here is described in three ways: by what its lyrics say, by how its recording
sounds, and by where it sits relative to every other song. This page explains how each of
those is produced, and says plainly which parts involve AI.

## The codebooks are human work

Before anything could be coded, there had to be something to code it *with*. The taxonomy
behind this site — the themes, the subjects, the kinds of advocacy, the moral framings —
was designed, tested and revised over multiple rounds until it described this music rather
than music in general. That is the part with a person's judgement in it, and everything
below depends on it.

You can read the whole vocabulary, definition by definition, on the
[Reference](/about/reference) page.

## Reading the lyrics

A large language model reads each song's lyrics and applies that codebook: it picks the
thematic codes that fit, and makes a set of judgements about how the song speaks — its
narrative perspective, its tone, how direct it is, who it seems to be addressing.

Each song shows its **most recent** coding pass. When the codebook improves and the songs
are coded again, what a song carries can change.

## Measuring the sound

Six further dimensions come from the recording itself rather than from the words: its
energy, its harmonic mood, its rhythm, its instrumentation, its vocal delivery, and its
tempo. These are measured by audio-analysis software, not judged — each one is a number
taken from the waveform and compared against a threshold. The [Reference](/about/reference)
page lists what is measured for each dimension and exactly where the thresholds fall.

## Placing songs next to each other

Each song's lyrics are turned into an *embedding* — a long list of numbers that puts songs
saying similar things near one another. That embedding is what positions a song on the
[Explore map](/explore)'s Thematic space. Its Sound space is positioned by the measured audio
dimensions described above instead, and its Holistic space by both together. The map is a
flattened picture of whichever space you're looking at, and the "You might also like"
suggestions on a song page read from the same sources directly.

There are two of those, and they measure different things. One compares what songs *say*,
using the lyric embedding; the other compares what they *sound like*, using the measured
audio dimensions. A song can be a close match on one and nowhere near on the other, which is
usually the interesting case.

## Where the rest of the information comes from

Genre, album and release date all come from Spotify.

The mood badge on a song card is entered by hand. That's different from the Mood shown on
the [Reference](/about/reference) page, which is measured from the audio. Languages and the
highlighted lyrics on a song page are entered by hand too.

## Where AI is used

Plainly, so there is no guessing:

- **The codebooks — human.** Designed and revised by a person over multiple rounds.
- **The per-song lyric coding — AI.** A language model applies the codebook to each song.
- **The sound dimensions — measured.** Signal analysis of the audio; no model judgement. The
  same measurements place a song on the Explore map's Sound space and drive the "Similar
  sound" tab on a song page.
- **The song positions and similarity everywhere else — AI.** An embedding model reading the
  lyrics; it drives the "Similar message" tab and the Explore map's Thematic space. The
  Holistic space mixes that model's reading with the measured sound, so it is part AI and
  part measurement.
- **Curation — human.** Which songs are here at all, and whether a song belongs, is always
  a person's decision.

As of {{codingDate}}, each song's most recent coding pass came from {{codingModels}}.

## What this doesn't tell you

**Not every song has been analysed.** {{analysed}} of {{songs}} songs currently carry a
coding pass ({{analysedPct}}), and {{mapped}} appear on the Explore map. The rest are in
the collection and searchable, but have no codes yet.

**The per-song coding is machine-generated and currently unchecked.** The codebooks were
built and refined by hand, but no one has gone through song by song to confirm that the
model applied them correctly. Human checking — and human coding — may follow.

**The codes describe what a song says, not whether it is any good.** Nothing here is a
rating.
