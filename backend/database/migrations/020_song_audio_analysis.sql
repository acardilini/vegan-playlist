-- 020 - the analysis project's decoupled audio table and the embedding provenance columns, so an
-- environment built from this repo has them. Both projects create these idempotently; on a database the
-- analysis project already populated this is a no-op. The web app is a READ-ONLY consumer of
-- song_audio_analysis (genre choices the curator accepts are written to songs, never here).
-- Schema as given in the analysis project's Phase 2 handoff (V2.1 pipeline).
CREATE TABLE IF NOT EXISTS song_audio_analysis (
    song_id                   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    model_used                VARCHAR(64) NOT NULL,
    pipeline_version          VARCHAR(32) NOT NULL DEFAULT 'v2.1',
    audio_status              VARCHAR(24) NOT NULL DEFAULT 'PENDING', -- PENDING | OK | UNAVAILABLE | TOO_LONG | ERROR
    youtube_id_used           VARCHAR(32),
    duration_sec              REAL,
    tempo_bpm                 INTEGER,
    tempo_iqr_bpm             REAL,
    tempo_stability           VARCHAR(16),
    loudness_lufs             REAL,
    dynamic_range_lra         REAL,
    crest_factor_db           REAL,
    musical_key               VARCHAR(16),
    musical_mode              VARCHAR(16),
    key_confidence            REAL,
    mir_computed_at           TIMESTAMP,
    musical_mood              TEXT[],
    sonic_intensity           VARCHAR(64),
    production_texture        VARCHAR(64),
    vocal_style               TEXT[],
    rhythmic_feel             VARCHAR(64),
    instrumentation           TEXT[],
    audio_samples             TEXT[],
    dynamic_arc               VARCHAR(64),
    sonic_summary             TEXT,
    sonic_evidence            JSONB,
    sample_details            JSONB,
    inferred_parent_genre     VARCHAR(64),
    inferred_subgenre         VARCHAR(100),
    inferred_secondary_genre  VARCHAR(100),
    genre_confidence          VARCHAR(16),
    genre_rationale           TEXT,
    reviewer_model            VARCHAR(64),
    review_triggered_reasons  TEXT[],
    review_notes              TEXT,
    reviewed_at               TIMESTAMP,
    prompt_tokens             INTEGER,
    output_tokens             INTEGER,
    thought_tokens            INTEGER,
    error_message             TEXT,
    analyzed_at               TIMESTAMP,
    PRIMARY KEY (song_id, model_used)
);

ALTER TABLE song_embeddings ADD COLUMN IF NOT EXISTS audio_embedding_model  VARCHAR(64);
ALTER TABLE song_embeddings ADD COLUMN IF NOT EXISTS audio_hybrid_embedding float8[];
ALTER TABLE song_embeddings ADD COLUMN IF NOT EXISTS audio_hybrid_model     VARCHAR(64);
