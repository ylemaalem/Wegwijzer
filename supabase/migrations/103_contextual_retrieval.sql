-- Contextual Retrieval (punt 5, 2026-10-23), eerst als proef naast de huidige zoekroute.
-- Per stuk een korte context (1-2 zinnen die het stuk binnen het document situeren),
-- gemaakt door Claude met het hele document in de prompt. Op context + stuk komen een
-- eigen embedding (embedding_ctx) en een eigen woordindex (fts_ctx).
-- chunk_text, embedding en fts blijven ongewijzigd: de huidige zoekfuncties merken niets.
-- De _ctx-functies vallen per stuk terug op de oude embedding zolang er nog geen
-- context is (nieuwe of nog niet verwerkte documenten blijven dus vindbaar).
-- Rechten: dezelfde als de bestaande zoekfuncties (alleen service_role); de tabelregels
-- van document_chunks veranderen niet. Test: tests/sql/contextual_retrieval.sql

-- De nieuwe opgeslagen kolom herschrijft de tabel; de ivfflat-index wordt daarbij
-- opnieuw opgebouwd en heeft meer werkgeheugen nodig dan de standaard 32 MB.
SET LOCAL maintenance_work_mem = '128MB';

ALTER TABLE public.document_chunks
  ADD COLUMN context text CHECK (char_length(context) <= 1000),
  ADD COLUMN embedding_ctx vector(1536),
  ADD COLUMN fts_ctx tsvector GENERATED ALWAYS AS
    (to_tsvector('dutch', COALESCE(context, '') || ' ' || COALESCE(chunk_text, ''))) STORED;
CREATE INDEX idx_document_chunks_fts_ctx ON public.document_chunks USING gin (fts_ctx);

CREATE OR REPLACE FUNCTION public.match_document_chunks_ctx(query_embedding vector, match_org_id uuid, match_count integer DEFAULT 6, match_threshold double precision DEFAULT 0.6)
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
    1 - (COALESCE(dc.embedding_ctx, dc.embedding) <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE
    dc.org_id = match_org_id
    AND dc.embedding IS NOT NULL
    AND 1 - (COALESCE(dc.embedding_ctx, dc.embedding) <=> query_embedding) >= match_threshold
    AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = dc.document_id AND d.uitgesloten_van_zoeken)
  ORDER BY 1 - (COALESCE(dc.embedding_ctx, dc.embedding) <=> query_embedding) DESC, dc.id
  LIMIT match_count;
END;
$function$;

-- Gelijk aan zoek_chunks_trefwoord, maar op fts_ctx (context + stuk) en met de
-- afkortingen ook in de context.
CREATE OR REPLACE FUNCTION public.zoek_chunks_trefwoord_ctx(zoekvraag text, query_embedding vector, match_org_id uuid, match_count integer DEFAULT 10)
 RETURNS TABLE(id uuid, document_id uuid, chunk_text text, similarity double precision, score double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  qlex AS (
    SELECT DISTINCT unnest(tsvector_to_array(to_tsvector('dutch', zoekvraag))) AS lex
  ),
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
    SELECT dc.id, dc.document_id, dc.chunk_text,
           COALESCE(dc.context, '') || ' ' || dc.chunk_text AS zoektekst,
           dc.fts_ctx AS fts, COALESCE(dc.embedding_ctx, dc.embedding) AS embedding,
           length(COALESCE(dc.context, '') || ' ' || dc.chunk_text)::float AS len
    FROM document_chunks dc
    WHERE dc.org_id = match_org_id AND dc.embedding IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.id = dc.document_id AND d.uitgesloten_van_zoeken)
  ),
  stats AS (SELECT count(*)::float AS n, avg(len) AS avgdl FROM basis),
  kand AS (
    SELECT b.* FROM basis b, tq
    WHERE (tq.q IS NOT NULL AND b.fts @@ tq.q)
       OR EXISTS (SELECT 1 FROM lits WHERE b.zoektekst ~ lits.pat)
  ),
  tf AS (
    SELECT k.id, u.lexeme AS term, coalesce(array_length(u.positions, 1), 1)::float AS tf, k.len
    FROM kand k CROSS JOIN LATERAL unnest(k.fts) u
    WHERE u.lexeme IN (SELECT lex FROM qlex)
    UNION ALL
    SELECT k.id, l.pat, regexp_count(k.zoektekst, l.pat)::float, k.len
    FROM kand k JOIN lits l ON k.zoektekst ~ l.pat
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

-- Zelfde rechten als de bestaande zoekfuncties: alleen de server.
REVOKE ALL ON FUNCTION public.match_document_chunks_ctx(vector, uuid, integer, double precision) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.zoek_chunks_trefwoord_ctx(text, vector, uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks_ctx(vector, uuid, integer, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.zoek_chunks_trefwoord_ctx(text, vector, uuid, integer) TO service_role;
