---
name: reddit-thread-import
description: Use when the curator pastes Reddit thread text (or a chunk of one) asking for vegan band/song suggestions, and wants the bands, songs and vegan claims pulled out and checked against the catalogue. Triggers on "paste a Reddit thread", "extract bands from this thread", "thread import".
---

# Reddit thread import

Turns pasted thread text into an overview (what is new, what the catalogue already has) and, once the curator approves, writes it:
unknown bands -> **Leads**, named songs by known artists -> **To be processed** (tagged "From Reddit thread"), vegan claims -> the
admin-only **Claims from threads** notes on the artist or lead. Nothing is ever public. The curator makes every judgement.

## Steps

1. **Get the thread URL** (ask if not given). Each paste, or chunk of a long thread, is one run; re-pasting is harmless.
2. **Extract mentions** from the pasted text into JSON (shape below). Ignore ads, usernames, vote counts, "Reply/Share" chrome, jokes,
   people plugging their own music, and off-topic argument. Merge repeats of one band. A band named with no song has an empty `songs`.
   - **Never record a commenter's Reddit username.** Claims are about the *band member or artist*, not the commenter.
   - `quote` is a short supporting phrase, **200 characters at most**, in the commenter's words.
   - One `claims` entry per person per status. Whole-band claims ("all members of Avatar") use an empty `person`. Set `dispute` to a short
     phrase when the thread disputes or retracts the claim (and record the claim anyway). Keep disputed and "not vegan" claims.
   - `status` is exactly one of: `vegan`, `vegetarian`, `formerly_vegan`, `not_vegan`, `unsure`.
3. **Write the JSON** to the session scratchpad (absolute path), then from `backend/` run the **dry run**:
   `node scripts/importThread.js --file <abs path>`
4. **Show the curator the overview** (the script's output, lightly tidied) and ask for approval by number: "go", "go except 4, 9", or
   "include 12" (items marked *skipped by default* are only written when included).
5. **Only after approval**, run it again with `--apply`, plus `--skip 4,9` and/or `--include 12` as the curator said.
6. **Report the result lines** (what was added, what was already there, any `ERROR`). An item that errored can be re-run; writes are idempotent.

## JSON shape

```json
{ "thread": { "url": "https://www.reddit.com/r/vegan/comments/...", "title": "Vegans in music" },
  "mentions": [ {
      "artist": "Gojira", "songs": ["Fishing for Fishies"], "genre": "metal",
      "claims": [ { "person": "Joe Duplantier", "status": "vegan", "quote": "short quote", "dispute": null } ] } ] }
```
`songs`, `genre` and `claims` may be empty or omitted.

## Rules

- Never run `--apply` without the curator's approval of the overview in this conversation.
- Never write to the database any other way, never use the admin password or HTTP, never run `taskkill` on node.
- Claims are unconfirmed notes for the curator to integrate later; do not touch `artist_members` or any vegan mark.
- If the script reports `Bad input`, fix the JSON and re-run the dry run; nothing was written.
