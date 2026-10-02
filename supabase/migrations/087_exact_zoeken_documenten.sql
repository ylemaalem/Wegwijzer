-- =============================================
-- WEGWIJZER — Migratie 087
-- Retrieval optie A: documentstukken altijd EXACT zoeken.
--
-- Onderzoek 2026-10-02 (305 vragen): de ivfflat-index (lists=100,
-- probes=10) doorzoekt maar 10% van de clusters en miste bij 30% van de
-- vragen het beste stuk, ook stukken die over de hele kennisbank de beste
-- match waren (testvragen 13, 22, 26, 29). Bij ~3.200 stukken kost exact
-- zoeken ~26 ms (warm) i.p.v. ~4 ms.
--
-- Sorteren op de similarity-expressie (niet op `embedding <=> query`)
-- maakt de ivfflat-index onbruikbaar voor deze query: de planner leest
-- alle stukken van de organisatie en rekent elke afstand uit. Zet de
-- sortering dus NIET terug naar de afstandsoperator — dan pakt de planner
-- de benaderende index weer.
--
-- De index zelf blijft bestaan (terugdraaien = de functie uit 068).
-- =============================================

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
  ORDER BY 1 - (dc.embedding <=> query_embedding) DESC, dc.id
  LIMIT match_count;
END;
$$;

-- CREATE OR REPLACE behoudt de bestaande grants (074: alleen service_role);
-- hier expliciet herhaald zodat deze migratie op zichzelf klopt.
REVOKE EXECUTE ON FUNCTION public.match_document_chunks(vector, uuid, integer, double precision) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector, uuid, integer, double precision) TO service_role;
