-- Een document uitsluiten van de zoekfunctie van de chat, zonder het te verwijderen
-- (vinkje in Beheer > Kennisbank > ✏️). Het document en zijn stukken blijven bestaan;
-- vector- en trefwoordzoeken slaan het over. Aanleiding: "Salaristabellen CAO
-- Gehandicaptenzorg" bevat dezelfde tabellen als CAO_H4, maar met de functiegroepen
-- door elkaar, waardoor het model soms een rij te ver las (2026-10-23).

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS uitgesloten_van_zoeken boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.documents.uitgesloten_van_zoeken IS
  'true = de chat gebruikt dit document niet (vector- en trefwoordzoeken, terugvalroute). Niet verwijderd.';

CREATE OR REPLACE FUNCTION public.match_document_chunks(query_embedding vector, match_org_id uuid, match_count integer DEFAULT 6, match_threshold double precision DEFAULT 0.6)
 RETURNS TABLE(id uuid, document_id uuid, chunk_text text, similarity double precision)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = dc.document_id AND d.uitgesloten_van_zoeken)
  ORDER BY 1 - (dc.embedding <=> query_embedding) DESC, dc.id
  LIMIT match_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.zoek_chunks_trefwoord(zoekvraag text, query_embedding vector, match_org_id uuid, match_count integer DEFAULT 10)
 RETURNS TABLE(id uuid, document_id uuid, chunk_text text, similarity double precision, score double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  -- Woordstammen van de vraag (stopwoorden vallen weg).
  qlex AS (
    SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('dutch', zoekvraag))) AS lex
  ),
  -- Losse woorden van de vraag zonder leestekens eromheen, voor afkortingen.
  tok AS (
    SELECT regexp_replace(w, '^[^[:alnum:]&]+|[^[:alnum:]&]+$', '', 'g') AS w
    FROM regexp_split_to_table(zoekvraag, '\s+') AS w
  ),
  lits AS (
    SELECT DISTINCT '(?i)\m' || split_part(w, '&', 1) || '\s*&\s*' || split_part(w, '&', 2) || '\M' AS pat
    FROM tok WHERE w ~ '^[[:alpha:]]{1,4}&[[:alpha:]]{1,4}$'
    UNION
    SELECT DISTINCT '\m' || w || '\M'
    FROM tok WHERE w ~ '^[[:upper:]]{2,6}$' AND to_tsvector('dutch', lower(w)) = ''::tsvector
  ),
  tq AS (
    SELECT CASE WHEN count(*) = 0 THEN NULL
                ELSE array_to_string(array_agg(quote_literal(lex)), ' | ')::tsquery END AS q
    FROM qlex
  ),
  basis AS (
    SELECT dc.id, dc.document_id, dc.chunk_text, dc.fts, dc.embedding, length(dc.chunk_text)::float AS len
    FROM document_chunks dc
    WHERE dc.org_id = match_org_id AND dc.embedding IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = dc.document_id AND d.uitgesloten_van_zoeken)
  ),
  stats AS (SELECT count(*)::float AS n, avg(len) AS avgdl FROM basis),
  kand AS (
    SELECT b.* FROM basis b, tq
    WHERE (tq.q IS NOT NULL AND b.fts @@ tq.q)
       OR EXISTS (SELECT 1 FROM lits WHERE b.chunk_text ~ lits.pat)
  ),
  tf AS (
    SELECT k.id, u.lexeme AS term, coalesce(array_length(u.positions, 1), 1)::float AS tf, k.len
    FROM kand k CROSS JOIN LATERAL unnest(k.fts) u
    WHERE u.lexeme IN (SELECT lex FROM qlex)
    UNION ALL
    SELECT k.id, l.pat, regexp_count(k.chunk_text, l.pat)::float, k.len
    FROM kand k JOIN lits l ON k.chunk_text ~ l.pat
  ),
  df AS (SELECT term, count(*)::float AS df FROM tf GROUP BY term),
  sc AS (
    SELECT tf.id,
           sum(ln(1 + (s.n - df.df + 0.5) / (df.df + 0.5))
               * tf.tf * 2.2 / (tf.tf + 1.2 * (0.25 + 0.75 * tf.len / s.avgdl))) AS score
    FROM tf JOIN df USING (term) CROSS JOIN stats s
    GROUP BY tf.id
  )
  SELECT k.id, k.document_id, k.chunk_text,
         1 - (k.embedding <=> query_embedding) AS similarity,
         sc.score
  FROM sc JOIN kand k ON k.id = sc.id
  ORDER BY sc.score DESC, k.id
  LIMIT match_count;
$function$;
