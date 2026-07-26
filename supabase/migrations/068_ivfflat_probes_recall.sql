-- =============================================
-- WEGWIJZER — Migratie 068
-- Ivfflat recall-fix: default probes=1 mist chunks in andere clusters.
-- Bewezen: FAN MN chunk 0 (sim 0.62, zou rank 10 moeten zijn) werd nooit
-- opgehaald met probes=1, maar wél met probes=10.
-- Fix: SET LOCAL ivfflat.probes = 10 binnen de RPC's — verhoogt recall
-- van ivfflat zonder herindex, tegen verwaarloosbare latency-kost bij
-- deze kennisbank-omvang.
-- =============================================

-- ---- match_document_chunks ----
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
  -- Verhoog ivfflat probes voor betere recall (10 clusters i.p.v. default 1).
  -- Werkt via set_config met is_local=true → alleen binnen deze transactie.
  PERFORM set_config('ivfflat.probes', '10', true);

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

-- ---- match_studytube_cursussen ----
CREATE OR REPLACE FUNCTION public.match_studytube_cursussen(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Idem: verhoogde probes voor StudyTube (kleinere index met lists=10 →
  -- probes=5 dekt 50% van de clusters, ruim voldoende).
  PERFORM set_config('ivfflat.probes', '5', true);

  RETURN QUERY
  SELECT
    sc.naam,
    sc.duur_minuten,
    sc.deeplink_url,
    1 - (sc.embedding <=> query_embedding) AS similarity
  FROM public.studytube_cursussen sc
  WHERE sc.tenant_id = tenant_id_input
    AND sc.embedding IS NOT NULL
    AND 1 - (sc.embedding <=> query_embedding) > match_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Ruim de tijdelijke hi_recall functie op (aangemaakt tijdens diagnose)
DROP FUNCTION IF EXISTS public.match_document_chunks_hi_recall(vector, uuid, int, float, int);
