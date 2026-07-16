# Lyrics & Vector Analysis to Main Project Integration Guide

This guide explains how the main application (**The Vegan Playlist**) can consume and integrate both the newly generated qualitative lyric coding data and the lyrical & acoustic vector mapping space.

---

## 1. Database Connections & Tables (Shared Instance)
Both the analysis service and the main project connect to the **same PostgreSQL database instance** (`vegan_playlist` on `localhost:5432`). 
* The database connection parameters for this analysis service are loaded dynamically from the main project's backend env file: `C:\Users\Owner\Documents\AI Applications\vegan-playlist\backend\.env`.
* Because they share the same database instance, all calculated qualitative results and high-dimensional embeddings are already present, indexed, and queryable directly by the main application's backend.

---

## 2. Table Schema: Qualitative & Vector Databases

### A. Qualitative Coding Table: `song_lyric_analysis`
Stores structured classifications, emotions, tones, perspectives, and verbatim evidence for the lyrics:

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
> [!WARNING]
> **Composite Primary Key Filter:** Because we support multiple coding models, the table uses a composite primary key `(song_id, model_used)`. Every query joining this table **MUST filter by `model_used`** to avoid returning duplicate rows for a single song. The default recommended model is `'gemma4:latest'`.

### B. High-Dimensional Embeddings Table: `song_embeddings`
Stores the raw, calculated deep learning vector embeddings. This acts as our caching database to support delta checks and avoid unnecessary GPU recalculation:

```sql
CREATE TABLE song_embeddings (
    song_id INTEGER PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
    lyric_embedding float8[],       -- 768 dimensions (nomic-embed-text-v1)
    audio_embedding float8[],       -- 768 dimensions (MERT-v1-330M)
    lyric_hash VARCHAR(64),         -- md5 hash of lyrics to detect edits
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. High-Performance SQL Query Examples

Below are copy-pasteable PostgreSQL queries for the main project's backend.

### A. Fetching a Song with Its Qualitative Analysis
Use this query to load the full qualitative profile of a song for its detail pages:
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

---

## 4. Lyrical & Acoustic Vector Mapping Integration

We apply UMAP (Uniform Manifold Approximation and Projection) to project the high-dimensional song spaces down into coordinate spaces. These are saved directly to your React app's public assets:
* **JSON Location:** `C:\Users\Owner\Documents\AI Applications\vegan-playlist\frontend\public\vector_space.json`

### A. Vector Spaces Structure
Each song is mapped across three distinct coordinate spaces (each providing both `2D` and `3D` coordinates):

1. **Semantic Space (`semantic_2d`, `semantic_3d`):**
   * *Based on:* Pure `nomic-embed-text-v1` lyric embeddings.
   * *UI Purpose:* Clusters songs by verbal and poetic semantics.
2. **Thematic Space (`thematic_2d`, `thematic_3d`):**
   * *Based on:* Pure ~159-dimensional qualitative taxonomy coding (presence of themes, targets, actions, perspectives, tone, intensity, etc.).
   * *UI Purpose:* Clusters songs strictly by qualitative classification (e.g. grouping confrontational tracks or cow-focused advocacy, regardless of vocabulary).
3. **Acoustic Space (`audio_2d`, `audio_3d`):**
   * *Based on:* Pure `MERT-v1-330M` audio embeddings.
   * *UI Purpose:* Clusters songs by musicality, rhythm, instrumentation, and energy.

### B. Sample Frontend React Integration
Your React mapping component (e.g., using D3, Three.js, or React Three Fiber) can load the payload once and enable users to toggle/animate between these three coordinate spaces:

```javascript
import React, { useEffect, useState } from 'react';

function VectorSpaceMap() {
  const [data, setData] = useState([]);
  const [space, setSpace] = useState('semantic'); // 'semantic', 'thematic', or 'audio'
  const [dimensions, setDimensions] = useState('2d'); // '2d' or '3d'

  useEffect(() => {
    // Fetches static vector payload from public folder
    fetch('/vector_space.json')
      .then(res => res.json())
      .then(data => setData(data));
  }, []);

  // Map coordinates dynamically based on toggle buttons
  const getCoordinates = (song) => {
    const key = `${space}_${dimensions}`; // e.g. 'semantic_2d', 'thematic_3d'
    return song[key] || [0, 0, 0];
  };

  return (
    <div>
      <div className="controls">
        <button onClick={() => setSpace('semantic')}>Semantic (Words)</button>
        <button onClick={() => setSpace('thematic')}>Thematic (Coding)</button>
        <button onClick={() => setSpace('audio')}>Acoustic (Sound)</button>
        <button onClick={() => setDimensions('2d')}>2D Map</button>
        <button onClick={() => setDimensions('3d')}>3D Map</button>
      </div>
      {/* Feed coordinates into your visualization renderer */}
    </div>
  );
}
```

---

## 5. Ongoing Pipeline Management & Monthly Syncing

The main React/Express project only displays the data and does not run any deep learning models. 

When you add new songs, update lyrics, or modify manual tags in the main project, you can update both the qualitative coding and the UMAP vector coordinates by running these commands:

### Step 1: Run Qualitative Lyric Coding
Syncs new tracks and codes them locally via Gemma 4 split-prompting:
```bash
npm run sync-and-code:local
```

### Step 2: Compute Vectors & Update Maps
Syncs new audio/text embeddings and recalculates UMAP coordinates, rewriting the static public JSON payload:
```bash
npm run vectors
```
*(Both scripts use database caching and delta checks to only process new or modified songs, executing in seconds).*
