-- Voeg embedding kolom toe aan studytube_cursussen voor semantisch zoeken
ALTER TABLE studytube_cursussen
ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS idx_studytube_cursussen_embedding
ON studytube_cursussen
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 10);

-- RPC functie voor cosine similarity matching
CREATE OR REPLACE FUNCTION match_studytube_cursussen(
  query_embedding vector(1536),
  tenant_id_input uuid,
  match_threshold float DEFAULT 0.65,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  naam text,
  duur_minuten integer,
  deeplink_url text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    sc.naam,
    sc.duur_minuten,
    sc.deeplink_url,
    1 - (sc.embedding <=> query_embedding) as similarity
  FROM studytube_cursussen sc
  WHERE sc.tenant_id = tenant_id_input
    AND sc.embedding IS NOT NULL
    AND 1 - (sc.embedding <=> query_embedding) > match_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count;
$$;
