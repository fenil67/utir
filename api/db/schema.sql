CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE servers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_url    TEXT UNIQUE NOT NULL,
  name          TEXT,
  description   TEXT,
  language      TEXT,
  stars         INTEGER DEFAULT 0,
  last_pushed   TIMESTAMP,
  owner         TEXT,
  topics        TEXT[],
  confirmed     BOOLEAN DEFAULT FALSE,
  classified    BOOLEAN DEFAULT FALSE,
  embedding     vector(1536),
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE scans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id           UUID REFERENCES servers(id),
  scanned_at          TIMESTAMP DEFAULT NOW(),
  trust_score         INTEGER,
  auth_tier           TEXT,
  static_score        INTEGER,
  deps_score          INTEGER,
  behavior_score      INTEGER,
  maintenance_score   INTEGER,
  findings            JSONB,
  raw_output          JSONB
);

CREATE TABLE tools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id     UUID REFERENCES servers(id),
  name          TEXT,
  description   TEXT,
  input_schema  JSONB
);

CREATE INDEX ON servers USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
CREATE INDEX ON scans(server_id);
CREATE INDEX ON scans(trust_score);