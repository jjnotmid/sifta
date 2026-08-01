-- ===========================================================================
-- Sifta schema — the four memory layers, one consistency domain.
--
--   Semantic   name_variant, alert.narration_vec, decision.rationale_vec
--   Episodic   alert
--   Procedural investigation
--   Ledger     decision  (append-only; see the grants at the bottom)
--
-- Two rules that are load-bearing, not stylistic:
--
--   1. Vector indexes are declared INLINE in CREATE TABLE. A standalone
--      CREATE VECTOR INDEX on a populated table blocks INSERT/UPDATE/DELETE on
--      that column until the backfill finishes, which presents as a hung app.
--
--   2. Every vector index is PREFIXED by a partition key (jurisdiction, or
--      subject_key on the ledger). A Nigerian screen searches only the
--      Nigerian partition rather than the global index. `npm run explain`
--      demonstrates this.
--
-- On VECTOR(1024): this file is the source of truth for the embedding width,
-- but the width itself is owned by ONE constant — EMBEDDING_DIMENSIONS in
-- src/config.ts. The migration runner rewrites every VECTOR(n) in this file to
-- that value before applying it, so switching Titan (1024) to a local
-- MiniLM model (384) is a single env var, not six hand edits.
-- ===========================================================================

-- Watchlist entities (sanctions/PEP targets).
CREATE TABLE IF NOT EXISTS watchlist_entity (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_list     STRING NOT NULL,          -- 'OFAC_SDN' | 'UN' | 'EU' | 'UK_OFSI'
  source_ref      STRING NOT NULL,
  jurisdiction    STRING NOT NULL,
  primary_name    STRING NOT NULL,
  dob             DATE,
  nationality     STRING,
  raw_payload     JSONB,
  ingested_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source_list, source_ref)
);

-- Name variants, embedded. The semantic memory layer.
CREATE TABLE IF NOT EXISTS name_variant (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       UUID NOT NULL REFERENCES watchlist_entity(id),
  jurisdiction    STRING NOT NULL,
  variant_text    STRING NOT NULL,
  variant_kind    STRING NOT NULL,          -- 'primary'|'aka'|'translit'|'reordered'|...
  embedding       VECTOR(1024),
  VECTOR INDEX name_vec_idx (jurisdiction, embedding vector_l2_ops),
  INDEX idx_variant_entity (entity_id),
  -- Re-running variant generation must not duplicate rows.
  UNIQUE (entity_id, variant_text, variant_kind)
);

-- Alerts raised. Episodic memory.
CREATE TABLE IF NOT EXISTS alert (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_name    STRING NOT NULL,
  subject_key     STRING NOT NULL,          -- normalised subject identity
  subject_dob     DATE,
  subject_nat     STRING,
  jurisdiction    STRING NOT NULL,
  txn_ref         STRING,
  txn_narration   STRING,
  narration_vec   VECTOR(1024),
  matched_entity  UUID REFERENCES watchlist_entity(id),
  match_distance  DECIMAL(10,6),
  status          STRING NOT NULL DEFAULT 'OPEN',  -- OPEN|INVESTIGATING|CLEARED|HIT|ESCALATED
  raised_at       TIMESTAMPTZ DEFAULT now(),
  VECTOR INDEX alert_narration_idx (jurisdiction, narration_vec vector_l2_ops),
  INDEX idx_alert_status (status, raised_at DESC),
  INDEX idx_alert_subject (subject_key, raised_at DESC)
);

-- Immutable decision ledger. Never UPDATE. Never DELETE.
CREATE TABLE IF NOT EXISTS decision (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alert(id),
  subject_key     STRING NOT NULL,          -- normalised subject identity
  entity_id       UUID REFERENCES watchlist_entity(id),
  disposition     STRING NOT NULL,          -- CLEARED|HIT|ESCALATED
  rationale       STRING NOT NULL,          -- analyst's words: the durable asset
  rationale_vec   VECTOR(1024),
  decided_by      STRING NOT NULL,
  agent_assisted  BOOL DEFAULT true,
  agent_reasoning JSONB,
  decided_at      TIMESTAMPTZ DEFAULT now(),
  VECTOR INDEX decision_vec_idx (subject_key, rationale_vec vector_l2_ops),
  INDEX idx_decision_subject (subject_key, decided_at DESC)
);

-- Live agent investigation state. Procedural memory.
CREATE TABLE IF NOT EXISTS investigation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID NOT NULL REFERENCES alert(id),
  state           STRING NOT NULL,          -- PENDING|GATHERING|REASONING|AWAITING_HUMAN|DONE
  step_count      INT DEFAULT 0,
  tool_trace      JSONB,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  INDEX idx_investigation_alert (alert_id)
);

-- ---------------------------------------------------------------------------
-- Least-privilege application role.
--
-- The app never connects as root. `sifta_app` gets SELECT+INSERT on the
-- ledger and nothing more — the append-only guarantee is enforced by the
-- database's own privilege system, not by application discipline. A bug in
-- our code cannot rewrite a decision an analyst signed.
-- ---------------------------------------------------------------------------
-- CREATE USER, not CREATE ROLE: this account logs in. It is the connection
-- string the application and the Lambda actually use. Root is never used
-- outside migrations.
CREATE USER IF NOT EXISTS sifta_app;

GRANT CONNECT ON DATABASE sifta TO sifta_app;
GRANT USAGE ON SCHEMA public TO sifta_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  watchlist_entity, name_variant, alert, investigation TO sifta_app;

GRANT SELECT, INSERT ON TABLE decision TO sifta_app;
REVOKE UPDATE, DELETE ON TABLE decision FROM sifta_app;
