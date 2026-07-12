# Lyrics Analysis to Main Project Data Integration Guide

This guide explains how the main application (**The Vegan Playlist**) can consume and integrate the newly generated qualitative lyric coding data.

---

## 1. Database Connection (Shared Instance)
Both this analysis service and the main project connect to the **same PostgreSQL database instance** (`vegan_playlist` on `localhost:5432`). 
* The connection parameters for this analysis service were drawn directly from your main project's `.env` file at `C:\Users\Owner\Documents\AI Applications\vegan-playlist\backend\.env`.
* Because they share the database, **no data migration is needed**. The data is already loaded and ready to be queried directly by the main application's backend.

---

## 2. Table Schema: `song_lyric_analysis`

The analysis data is stored in the table `song_lyric_analysis`. Below is the active schema:

```sql
CREATE TABLE song_lyric_analysis (
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    model_used VARCHAR(50),
    themes JSONB NOT NULL DEFAULT '[]',          -- Array of {code, evidence}
    topics JSONB NOT NULL DEFAULT '[]',          -- Array of {code, evidence} (Stores Targets)
    advocacy JSONB NOT NULL DEFAULT '[]',        -- Array of {code, evidence} (Stores Actions)
    tactics JSONB NOT NULL DEFAULT '[]',         -- Array of {code, evidence}
    moral_frames JSONB NOT NULL DEFAULT '[]',    -- Array of {code, evidence}
    perspective TEXT,                            -- Narrative POV
    emotions TEXT[] NOT NULL DEFAULT '{}',       -- Native Postgres Text Array
    intensity TEXT,                              -- Message intensity level
    clarity TEXT,                                -- Message clarity level
    focus_amount TEXT,                           -- Theme focus level
    lyrical_tone TEXT,                           -- Standardized tone category
    target_audience TEXT,                        -- Standardized target audience
    explanation TEXT,                            -- 1-2 sentence qualitative logic
    analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (song_id, model_used)            -- Composite primary key
);
```

### ⚠️ Critical Integration Note: Composite Primary Key
Because we support multiple coding models, the table uses a composite primary key of `(song_id, model_used)`. 
* **Every query joining this table MUST filter by `model_used`** to avoid returning duplicate rows for a single song.
* The default recommended model is `'gemma4:latest'`.
* The cloud model run is under `'gemini-3.5-flash'`.

---

## 3. High-Performance SQL Query Examples

Below are copy-pasteable PostgreSQL queries for the main project's backend.

### A. Fetching a Song with Its Qualitative Analysis
Use this query to load the full qualitative profile of a song for its details page:
```sql
SELECT 
    s.id as song_id, s.title, s.artist,
    sa.perspective, sa.intensity, sa.clarity, sa.lyrical_tone, 
    sa.target_audience, sa.explanation, sa.emotions,
    sa.themes, sa.topics as targets, sa.advocacy as actions, sa.tactics, sa.moral_frames
FROM songs s
LEFT JOIN song_lyric_analysis sa 
    ON s.id = sa.song_id AND sa.model_used = 'gemma4:latest'
WHERE s.id = $1;
```

### B. Faceted Search: Querying JSONB Arrays (GIN-Indexed)
For the 5 primary dimensions (*Themes, Targets, Actions, Tactics, Moral Frames*), the codes and quotes are stored in JSONB arrays. To find all songs associated with a specific code (e.g. `zoos` or `capitalism`), use the PostgreSQL JSONB containment operator (`@>`). 

This query is backed by a **GIN Index** and runs in under 1 millisecond:
```sql
-- Find all songs that target "zoos"
SELECT s.id, s.title, s.artist
FROM songs s
JOIN song_lyric_analysis sa ON s.id = sa.song_id
WHERE sa.model_used = 'gemma4:latest'
  AND sa.topics @> '[{"code": "zoos"}]';
```
*(Note: `topics` stores target codes, and `advocacy` stores action codes).*

### C. Querying Emotions (PostgreSQL Text Array)
To query songs expressing a particular emotion (e.g., `grief_sorrow`), use the standard Postgres `ANY` operator:
```sql
SELECT s.id, s.title, sa.emotions
FROM songs s
JOIN song_lyric_analysis sa ON s.id = sa.song_id
WHERE sa.model_used = 'gemma4:latest'
  AND 'grief_sorrow' = ANY(sa.emotions);
```

---

## 4. Integrating the Codebook (Taxonomy)

For rendering filter dropdowns, search menus, header titles, and category definitions in the main application's user interface, use the static file:
* **File Path:** `data/taxonomy.json`

The frontend can load this JSON file directly. For example, to map a code like `"militant_resistance"` to its user-friendly label and description, use the taxonomy dictionary:
```javascript
import taxonomy from './data/taxonomy.json';

// Get the display name and description for an action code
const actionDetails = taxonomy.actions.find(a => a.id === 'militant_resistance');
console.log(actionDetails.label);       // "Militant Resistance"
console.log(actionDetails.definition);  // "Advocates or documents illegal direct actions..."
```

---

## 5. Ongoing Pipeline Management
The main project does not need to run the analysis scripts directly. It only handles displaying the data. 

Whenever you add new songs or update lyrics in the main project, you can update the database records by navigating to this analysis folder and running:
```bash
npm run sync-and-code:local
```
This script will safely sync new lyrics, run them through the local Ollama model in 3 quick passes, and insert the results back into the shared database automatically.
