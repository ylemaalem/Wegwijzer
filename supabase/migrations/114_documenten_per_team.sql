-- 114: documenten per team (relevantie in de chat, 2026-10-27).
-- documents.teams leeg = voor iedereen. Met teams: alleen in het antwoord voor medewerkers
-- met minstens één van die teams (de chatfunctie bepaalt dat, _shared/documentteams.ts).
-- Dit is GEEN afscherming: RLS en rechten op documents en document_chunks blijven gelijk.
-- Nieuwe kolom op een bestaande tabel: de bestaande tabelrechten gelden ook voor de kolom;
-- de policy admin_update_documents laat de beheerder hem invullen.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS teams text[] NOT NULL DEFAULT '{}';

-- De vier zoekfuncties krijgen een laatste parameter "uitsluiten" (document-ids), zodat er
-- vóór het zoeken gefilterd wordt en de beste stukken niet door weggefilterde stukken
-- worden opgevuld. Standaard leeg: een aanroep zonder de parameter werkt als voorheen.
-- Een parameter toevoegen kan niet met CREATE OR REPLACE; DROP en CREATE in één transactie.
-- Rechten gelijk aan voorheen: alleen service_role (en de eigenaar).

DROP FUNCTION public.match_document_chunks(public.vector, uuid, integer, double precision);
CREATE FUNCTION public.match_document_chunks(query_embedding vector, match_org_id uuid, match_count integer DEFAULT 6, match_threshold double precision DEFAULT 0.6, uitsluiten uuid[] DEFAULT '{}'::uuid[])
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
    AND NOT (dc.document_id = ANY (COALESCE(uitsluiten, '{}'::uuid[])))
  ORDER BY 1 - (dc.embedding <=> query_embedding) DESC, dc.id
  LIMIT match_count;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.match_document_chunks(public.vector, uuid, integer, double precision, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(public.vector, uuid, integer, double precision, uuid[]) TO service_role;

DROP FUNCTION public.match_document_chunks_ctx(public.vector, uuid, integer, double precision);
CREATE FUNCTION public.match_document_chunks_ctx(query_embedding vector, match_org_id uuid, match_count integer DEFAULT 6, match_threshold double precision DEFAULT 0.6, uitsluiten uuid[] DEFAULT '{}'::uuid[])
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
    AND NOT (dc.document_id = ANY (COALESCE(uitsluiten, '{}'::uuid[])))
  ORDER BY 1 - (COALESCE(dc.embedding_ctx, dc.embedding) <=> query_embedding) DESC, dc.id
  LIMIT match_count;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.match_document_chunks_ctx(public.vector, uuid, integer, double precision, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks_ctx(public.vector, uuid, integer, double precision, uuid[]) TO service_role;

DROP FUNCTION public.zoek_chunks_trefwoord(text, public.vector, uuid, integer);
CREATE FUNCTION public.zoek_chunks_trefwoord(zoekvraag text, query_embedding vector, match_org_id uuid, match_count integer DEFAULT 10, uitsluiten uuid[] DEFAULT '{}'::uuid[])
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
      AND NOT (dc.document_id = ANY (COALESCE(uitsluiten, '{}'::uuid[])))
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
REVOKE EXECUTE ON FUNCTION public.zoek_chunks_trefwoord(text, public.vector, uuid, integer, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zoek_chunks_trefwoord(text, public.vector, uuid, integer, uuid[]) TO service_role;

DROP FUNCTION public.zoek_chunks_trefwoord_ctx(text, public.vector, uuid, integer);
CREATE FUNCTION public.zoek_chunks_trefwoord_ctx(zoekvraag text, query_embedding vector, match_org_id uuid, match_count integer DEFAULT 10, uitsluiten uuid[] DEFAULT '{}'::uuid[])
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
      AND NOT (dc.document_id = ANY (COALESCE(uitsluiten, '{}'::uuid[])))
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
REVOKE EXECUTE ON FUNCTION public.zoek_chunks_trefwoord_ctx(text, public.vector, uuid, integer, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zoek_chunks_trefwoord_ctx(text, public.vector, uuid, integer, uuid[]) TO service_role;
