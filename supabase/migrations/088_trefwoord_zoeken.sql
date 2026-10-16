-- =============================================
-- WEGWIJZER — Migratie 088
-- Retrieval optie D: naast vector-zoeken ook op trefwoord zoeken.
--
-- Onderzoek 2026-10-16: bij 8 mislukte testvragen (8, 26, 33, 42-45, 60)
-- stond het antwoord in een stuk dat vector-zoeken niet in de top 8 zette,
-- bijvoorbeeld namen en datums uit het weekendrooster, "3564" uit de
-- salaristabel en afkortingen als "O&O". Trefwoord-zoeken (BM25) vindt ze
-- wel. De chatfunctie voegt de 2 beste trefwoordstukken TOE aan de bestaande
-- stukken (er valt niets weg).
--
-- Onderdelen:
--  1. fts: zoekindex van elk stuk (Nederlandse woordstammen), automatisch
--     berekend uit chunk_text; geen code hoeft hem te vullen.
--  2. GIN-index op fts.
--  3. zoek_chunks_trefwoord: BM25-score (k1 = 1,2, b = 0,75) over de
--     woordstammen van de vraag, plus afkortingen letterlijk: "X&Y" (ook
--     "X & Y", hoofdletterongevoelig) en woorden in hoofdletters die als
--     stopwoord wegvallen (bv. VAN), hoofdlettergevoelig. Geeft ook de
--     cosine-similarity met de vraag terug, zoals match_document_chunks.
--
-- Terugdraaien: in de chatfunctie TREFWOORD_AANVULLING = 0 (geen deploy van
-- de database nodig), of volledig:
--   DROP FUNCTION public.zoek_chunks_trefwoord(text, vector, uuid, integer);
--   DROP INDEX public.idx_document_chunks_fts;
--   ALTER TABLE public.document_chunks DROP COLUMN fts;
-- =============================================

-- De nieuwe kolom herschrijft de tabel, waardoor ook de ivfflat-index op
-- embedding opnieuw wordt opgebouwd (vraagt ~62 MB; standaard is 32 MB). Die
-- index wordt sinds 087 niet gebruikt bij het zoeken.
SET maintenance_work_mem = '128MB';

ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (to_tsvector('dutch', coalesce(chunk_text, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_document_chunks_fts ON public.document_chunks USING gin (fts);

CREATE OR REPLACE FUNCTION public.zoek_chunks_trefwoord(
  zoekvraag        text,
  query_embedding  vector(1536),
  match_org_id     uuid,
  match_count      int DEFAULT 10
)
RETURNS TABLE (
  id            uuid,
  document_id   uuid,
  chunk_text    text,
  similarity    float,
  score         float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.zoek_chunks_trefwoord(text, vector, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zoek_chunks_trefwoord(text, vector, uuid, integer) TO service_role;
