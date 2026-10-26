-- 113: beste stukken binnen opgegeven documenten (synoniemen en zoektermen, 2026-10-26).
-- Noemt de vraag een synoniem of een specifieke zoekterm van een document (bv. "O&S"
-- bij "Handleiding traject ondersteuning & stabiliteit"), dan doen de beste stukken van
-- dat document mee in de gewone zoekroute, ook als de afkorting in geen enkel stuk staat.
-- Alleen een nieuwe functie: geen tabel, geen RLS of policy, geen wijziging aan bestaande
-- rechten. SECURITY INVOKER: alleen de chatfunctie (service_role) mag hem aanroepen.
CREATE OR REPLACE FUNCTION public.match_chunks_in_documenten(
  query_embedding public.vector,
  match_org_id uuid,
  doc_ids uuid[],
  per_doc integer DEFAULT 2
)
RETURNS TABLE(id uuid, document_id uuid, chunk_text text, similarity double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT r.id, r.document_id, r.chunk_text, r.similarity
  FROM (
    SELECT dc.id, dc.document_id, dc.chunk_text,
           1 - (dc.embedding OPERATOR(public.<=>) query_embedding) AS similarity,
           row_number() OVER (PARTITION BY dc.document_id
                              ORDER BY dc.embedding OPERATOR(public.<=>) query_embedding, dc.id) AS rang
    FROM public.document_chunks dc
    WHERE dc.org_id = match_org_id
      AND dc.document_id = ANY (doc_ids)
      AND dc.embedding IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = dc.document_id AND d.uitgesloten_van_zoeken)
  ) r
  WHERE r.rang <= LEAST(GREATEST(per_doc, 1), 5)
  ORDER BY r.similarity DESC, r.id;
$function$;

REVOKE EXECUTE ON FUNCTION public.match_chunks_in_documenten(public.vector, uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_chunks_in_documenten(public.vector, uuid, uuid[], integer) TO service_role;
