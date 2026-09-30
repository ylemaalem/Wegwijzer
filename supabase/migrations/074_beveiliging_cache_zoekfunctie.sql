-- 074: beveiliging response_cache en zoekfuncties (3b + 3c)
--
-- A) response_cache (3b-A): de policy "Edge Functions kunnen cache schrijven"
--    was FOR ALL USING (true) voor iedere rol → iedereen met de publieke
--    anon key kon de cache lezen, wijzigen en wissen. De Edge Function
--    gebruikt de service role (omzeilt RLS) en heeft geen policy nodig.
--    Client-toegang blijft alleen voor: eigen rijen lezen, admin wist de
--    cache van de eigen organisatie (admin.js invalideerResponseCache).
-- B) response_cache (3b-B): de database leegt de cache zelf bij elke
--    wijziging aan de bronnen van een antwoord (documents, document_chunks,
--    kennisbank_items, kennisnotities) — ongeacht via welke route.
-- C) Zoekfuncties (3c-A): alleen nog uitvoerbaar door service_role. De
--    enige aanroeper is de chat Edge Function (supabaseAdmin). De functie-
--    bodies (incl. ivfflat.probes-fix) blijven ongewijzigd.

-- ============ A. response_cache policies en rechten ============
DROP POLICY IF EXISTS "Edge Functions kunnen cache schrijven" ON public.response_cache;
DROP POLICY IF EXISTS "Gebruikers kunnen eigen cache lezen" ON public.response_cache;

CREATE POLICY cache_eigen_lezen ON public.response_cache
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY cache_admin_wissen ON public.response_cache
  FOR DELETE TO authenticated
  USING ((get_my_role() = 'admin' AND tenant_id = get_my_tenant_id()) OR is_superadmin());

REVOKE ALL ON TABLE public.response_cache FROM anon;
REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.response_cache FROM authenticated;
GRANT SELECT, DELETE ON TABLE public.response_cache TO authenticated;

-- ============ B. Cache automatisch legen bij bronwijzigingen ============
CREATE OR REPLACE FUNCTION public.leeg_response_cache_rij()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.response_cache
  WHERE tenant_id IN (
    CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.tenant_id END
  );
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.leeg_response_cache_chunks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    DELETE FROM public.response_cache WHERE tenant_id IN (SELECT DISTINCT org_id FROM nieuwe_rijen);
  ELSE
    DELETE FROM public.response_cache WHERE tenant_id IN (SELECT DISTINCT org_id FROM oude_rijen);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leeg_response_cache_rij() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.leeg_response_cache_chunks() FROM PUBLIC, anon, authenticated;

-- Alleen kolommen die de inhoud van een antwoord bepalen; tellers en
-- feedbackvelden (gebruikt_count, kwaliteitsscore, ...) niet — die wijzigen
-- bij elk antwoord en zouden de cache anders continu legen.
DROP TRIGGER IF EXISTS trg_cache_leeg_documents ON public.documents;
CREATE TRIGGER trg_cache_leeg_documents
  AFTER INSERT OR DELETE OR UPDATE OF naam, content, map, notitie, zoektermen, synoniemen, user_id, documenttype, revisiedatum, tenant_id
  ON public.documents FOR EACH ROW EXECUTE FUNCTION public.leeg_response_cache_rij();

DROP TRIGGER IF EXISTS trg_cache_leeg_chunks_insert ON public.document_chunks;
CREATE TRIGGER trg_cache_leeg_chunks_insert
  AFTER INSERT ON public.document_chunks REFERENCING NEW TABLE AS nieuwe_rijen
  FOR EACH STATEMENT EXECUTE FUNCTION public.leeg_response_cache_chunks();

DROP TRIGGER IF EXISTS trg_cache_leeg_chunks_delete ON public.document_chunks;
CREATE TRIGGER trg_cache_leeg_chunks_delete
  AFTER DELETE ON public.document_chunks REFERENCING OLD TABLE AS oude_rijen
  FOR EACH STATEMENT EXECUTE FUNCTION public.leeg_response_cache_chunks();

DROP TRIGGER IF EXISTS trg_cache_leeg_kennisbank_items ON public.kennisbank_items;
CREATE TRIGGER trg_cache_leeg_kennisbank_items
  AFTER INSERT OR UPDATE OR DELETE ON public.kennisbank_items
  FOR EACH ROW EXECUTE FUNCTION public.leeg_response_cache_rij();

DROP TRIGGER IF EXISTS trg_cache_leeg_kennisnotities ON public.kennisnotities;
CREATE TRIGGER trg_cache_leeg_kennisnotities
  AFTER INSERT OR UPDATE OR DELETE ON public.kennisnotities
  FOR EACH ROW EXECUTE FUNCTION public.leeg_response_cache_rij();

-- ============ C. Zoekfuncties alleen voor service_role ============
REVOKE EXECUTE ON FUNCTION public.match_document_chunks(vector, uuid, integer, double precision) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_studytube_cursussen(vector, uuid, double precision, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_gebruikt_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector, uuid, integer, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.match_studytube_cursussen(vector, uuid, double precision, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_gebruikt_count(uuid) TO service_role;
