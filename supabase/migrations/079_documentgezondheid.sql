-- 079: documentgezondheid-overzicht (stap 2, optie 2A).
-- Puur SQL, geen AI. Per document worden signalen bepaald:
--   * dubbel: exact dezelfde inhoud als een ander document
--   * niet_geindexeerd: geen chunks of indexering_status = 'fout'
--   * pdf_weinig_tekst: PDF waarvan de chunk-tekst < 50% van de inhoud is
--     (mogelijk een scan/afbeelding-PDF die slecht geëxtraheerd is)
--   * nooit_gebruikt: gebruikt_count = 0 en ouder dan 60 dagen
--   * negatieve_feedback: meer negatieve dan positieve feedback (min. 2 negatief)
-- "Verouderd" is bewust NIET meegenomen (optie iii): revisiedatum is nergens
-- ingevuld, dus dat zou alleen ruis geven. Het aantal zonder revisiedatum wordt
-- wel als neutrale telling getoond.

CREATE TABLE IF NOT EXISTS public.documentgezondheid_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  gemaakt_op timestamptz NOT NULL DEFAULT now(),
  samenvatting jsonb NOT NULL DEFAULT '{}'::jsonb,
  details jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_docgezondheid_tenant ON public.documentgezondheid_snapshots (tenant_id, gemaakt_op DESC);

ALTER TABLE public.documentgezondheid_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS docgezondheid_admin_lezen ON public.documentgezondheid_snapshots;
CREATE POLICY docgezondheid_admin_lezen ON public.documentgezondheid_snapshots
  FOR SELECT TO authenticated
  USING ((get_my_role() = 'admin' AND tenant_id = get_my_tenant_id()) OR is_superadmin());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documentgezondheid_snapshots TO anon, authenticated;

-- Berekent het overzicht voor één tenant en geeft {samenvatting, details} terug.
CREATE OR REPLACE FUNCTION public.documentgezondheid(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _res jsonb;
BEGIN
  WITH d AS (
    SELECT dc.id, dc.naam, dc.map, dc.content, dc.documenttype, dc.extractie_methode,
           dc.gebruikt_count, dc.feedback_positief, dc.feedback_negatief, dc.indexering_status,
           dc.created_at, dc.revisiedatum
    FROM public.documents dc
    WHERE dc.tenant_id = p_tenant AND dc.user_id IS NULL
  ),
  ch AS (
    SELECT document_id, count(*) n, sum(length(chunk_text)) tl
    FROM public.document_chunks WHERE org_id = p_tenant GROUP BY document_id
  ),
  dup AS (
    SELECT md5(content) h FROM d WHERE content IS NOT NULL GROUP BY md5(content) HAVING count(*) > 1
  ),
  verrijkt AS (
    SELECT d.*, COALESCE(ch.n, 0) chunks, COALESCE(ch.tl, 0) chunk_tekst,
      (d.content IS NOT NULL AND md5(d.content) IN (SELECT h FROM dup)) is_dubbel,
      (COALESCE(ch.n,0) = 0 OR d.indexering_status = 'fout') is_niet_geindexeerd,
      (d.extractie_methode LIKE 'pdf%' AND length(COALESCE(d.content,'')) > 500 AND COALESCE(ch.tl,0) < length(d.content) * 0.5) is_pdf_weinig_tekst,
      (COALESCE(d.gebruikt_count,0) = 0 AND d.created_at < now() - interval '60 days') is_nooit_gebruikt,
      (COALESCE(d.feedback_negatief,0) >= 2 AND COALESCE(d.feedback_negatief,0) > COALESCE(d.feedback_positief,0)) is_neg_feedback
    FROM d LEFT JOIN ch ON ch.document_id = d.id
  )
  SELECT jsonb_build_object(
    'gemaakt_op', now(),
    'samenvatting', jsonb_build_object(
      'totaal', (SELECT count(*) FROM verrijkt),
      'dubbel', (SELECT count(*) FROM verrijkt WHERE is_dubbel),
      'niet_geindexeerd', (SELECT count(*) FROM verrijkt WHERE is_niet_geindexeerd),
      'pdf_weinig_tekst', (SELECT count(*) FROM verrijkt WHERE is_pdf_weinig_tekst),
      'nooit_gebruikt', (SELECT count(*) FROM verrijkt WHERE is_nooit_gebruikt),
      'negatieve_feedback', (SELECT count(*) FROM verrijkt WHERE is_neg_feedback),
      'zonder_revisiedatum', (SELECT count(*) FROM verrijkt WHERE revisiedatum IS NULL),
      'aandacht_nodig', (SELECT count(*) FROM verrijkt WHERE is_dubbel OR is_niet_geindexeerd OR is_pdf_weinig_tekst OR is_nooit_gebruikt OR is_neg_feedback)
    ),
    'details', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'naam', naam, 'map', map, 'gebruikt_count', COALESCE(gebruikt_count,0),
        'problemen', (
          ARRAY[]::text[]
          || CASE WHEN is_dubbel THEN ARRAY['dubbel'] ELSE ARRAY[]::text[] END
          || CASE WHEN is_niet_geindexeerd THEN ARRAY['niet geïndexeerd'] ELSE ARRAY[]::text[] END
          || CASE WHEN is_pdf_weinig_tekst THEN ARRAY['PDF weinig tekst (mogelijk scan)'] ELSE ARRAY[]::text[] END
          || CASE WHEN is_nooit_gebruikt THEN ARRAY['nooit gebruikt'] ELSE ARRAY[]::text[] END
          || CASE WHEN is_neg_feedback THEN ARRAY['veel negatieve feedback'] ELSE ARRAY[]::text[] END
        )
      ) ORDER BY naam)
      FROM verrijkt
      WHERE is_dubbel OR is_niet_geindexeerd OR is_pdf_weinig_tekst OR is_nooit_gebruikt OR is_neg_feedback
    ), '[]'::jsonb)
  ) INTO _res;
  RETURN _res;
END;
$$;

-- Niet aan authenticated geven: de functie neemt een tenant-parameter en checkt
-- die niet, dus directe toegang zou cross-tenant zijn. De admin-wrapper
-- mijn_documentgezondheid() (SECURITY DEFINER) roept hem intern aan.
REVOKE EXECUTE ON FUNCTION public.documentgezondheid(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.documentgezondheid(uuid) TO service_role;

-- Admin-wrapper: overzicht voor de eigen tenant, met rolcheck.
CREATE OR REPLACE FUNCTION public.mijn_documentgezondheid()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT ((get_my_role() = 'admin') OR is_superadmin()) THEN
    RAISE EXCEPTION 'Alleen admin';
  END IF;
  RETURN public.documentgezondheid(get_my_tenant_id());
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mijn_documentgezondheid() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mijn_documentgezondheid() TO authenticated;

-- Wekelijkse snapshot (puur SQL, geen kosten). Bewaart een momentopname per tenant.
CREATE OR REPLACE FUNCTION public.snapshot_documentgezondheid()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t record;
  _r jsonb;
BEGIN
  FOR _t IN SELECT id FROM public.tenants LOOP
    _r := public.documentgezondheid(_t.id);
    INSERT INTO public.documentgezondheid_snapshots (tenant_id, samenvatting, details)
    VALUES (_t.id, _r->'samenvatting', _r->'details');
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.snapshot_documentgezondheid() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE _jid bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'documentgezondheid-wekelijks') THEN
    PERFORM cron.unschedule('documentgezondheid-wekelijks');
  END IF;
  -- Wekelijks maandag 04:30 (vóór de eventuele regressietest om 05:00).
  _jid := cron.schedule('documentgezondheid-wekelijks', '30 4 * * 1', 'SELECT public.snapshot_documentgezondheid();');
END $$;
