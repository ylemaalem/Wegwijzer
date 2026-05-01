-- =============================================
-- WEGWIJZER — Migratie 053
-- Vector embeddings: pgvector extensie + document_chunks tabel
-- met ivfflat index en match_document_chunks() functie.
-- =============================================

-- STAP 0: pgvector extensie
CREATE EXTENSION IF NOT EXISTS vector;

-- STAP 1: document_chunks tabel
CREATE TABLE IF NOT EXISTS public.document_chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  org_id         uuid NOT NULL,
  chunk_index    integer NOT NULL,
  chunk_text     text NOT NULL,
  embedding      vector(1536),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

-- Index voor snelle similarity search
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON public.document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index voor org_id filtering
CREATE INDEX IF NOT EXISTS idx_document_chunks_org_id
  ON public.document_chunks (org_id);

-- Index voor document_id lookups
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id
  ON public.document_chunks (document_id);

-- RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- Medewerkers kunnen alleen chunks van hun eigen org lezen
CREATE POLICY "chunks_select_own_org"
  ON public.document_chunks
  FOR SELECT
  USING (
    org_id = (
      SELECT org_id FROM public.profiles WHERE id = auth.uid() LIMIT 1
    )
  );

-- Service role kan alles (voor Edge Function writes)
CREATE POLICY "chunks_service_all"
  ON public.document_chunks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- STAP 2: match_document_chunks() functie voor semantic search
CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding  vector(1536),
  match_org_id     uuid,
  match_count      int DEFAULT 6,
  match_threshold  float DEFAULT 0.6
)
RETURNS TABLE (
  id            uuid,
  document_id   uuid,
  chunk_text    text,
  similarity    float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_text,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE
    dc.org_id = match_org_id
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
