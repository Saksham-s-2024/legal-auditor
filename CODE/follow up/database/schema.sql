CREATE EXTENSION IF NOT EXISTS vector;


CREATE TABLE IF NOT EXISTS workspaces (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE IF NOT EXISTS contracts (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    file_name     VARCHAR(255) NOT NULL,
    sha256_hash   CHAR(64)    UNIQUE NOT NULL,
    ingested_at   TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contracts_workspace ON contracts(workspace_id);

CREATE TABLE IF NOT EXISTS parent_chunks (
    id            UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id   UUID  NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    workspace_id  UUID  NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    header_title  TEXT,
    text_content  TEXT  NOT NULL,
    chunk_order   INT   NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_parent_chunks_contract ON parent_chunks(contract_id);
CREATE INDEX IF NOT EXISTS idx_parent_chunks_workspace ON parent_chunks(workspace_id);


CREATE TABLE IF NOT EXISTS child_chunks (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id          UUID        NOT NULL REFERENCES parent_chunks(id) ON DELETE CASCADE,
    workspace_id       UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    text_content       TEXT        NOT NULL,
    semantic_embedding VECTOR(384) NOT NULL,
    chunk_order        INT         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_child_chunks_parent ON child_chunks(parent_id);
CREATE INDEX IF NOT EXISTS idx_child_chunks_workspace ON child_chunks(workspace_id);


CREATE INDEX IF NOT EXISTS child_vector_hnsw_idx
    ON child_chunks
    USING hnsw (semantic_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);


ALTER TABLE child_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_isolation_policy ON child_chunks;
CREATE POLICY workspace_isolation_policy ON child_chunks
    FOR ALL
    USING (workspace_id = current_setting('app.current_workspace_id')::UUID);

ALTER TABLE parent_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parent_workspace_isolation_policy ON parent_chunks;
CREATE POLICY parent_workspace_isolation_policy ON parent_chunks
    FOR ALL
    USING (workspace_id = current_setting('app.current_workspace_id')::UUID);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contracts_workspace_isolation_policy ON contracts;
CREATE POLICY contracts_workspace_isolation_policy ON contracts
    FOR ALL
    USING (workspace_id = current_setting('app.current_workspace_id')::UUID);


INSERT INTO workspaces (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'default')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION search_child_chunks(
    query_embedding  VECTOR(384),
    target_workspace UUID,
    top_k            INT DEFAULT 20
)
RETURNS TABLE (
    child_id    UUID,
    parent_id   UUID,
    similarity  FLOAT
)
LANGUAGE sql STABLE AS $$
    SELECT
        id          AS child_id,
        parent_id,
        1 - (semantic_embedding <=> query_embedding) AS similarity
    FROM child_chunks
    WHERE workspace_id = target_workspace
    ORDER BY semantic_embedding <=> query_embedding
    LIMIT top_k;
$$;
