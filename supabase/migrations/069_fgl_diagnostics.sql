-- =============================================
-- WEGWIJZER — Migratie 069
-- fgl_diagnostics: persistente diagnostiek voor Fact-Grounding retrieval.
-- Doel: elke feitvraag laat sporen na, zodat je bij een fout antwoord
-- direct kunt zien wélke chunks het model kreeg, wat de extractie deed,
-- en waar het misging. Vervangt "logs zijn al weg tegen de tijd dat je
-- ze wilt lezen"-debugging.
-- =============================================

CREATE TABLE IF NOT EXISTS public.fgl_diagnostics (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  user_id              uuid,
  vraag                text NOT NULL,
  is_feit_vraag        boolean NOT NULL DEFAULT false,
  zoek_methode         text,             -- "vector" | "zoektermen" | "bronvraag" | "geen"
  match_count          integer,
  chunks_opgehaald     integer,          -- ruwe count uit RPC
  chunks_na_rerank     integer,          -- top-N na feit-rerank
  feit_chunk_docs      jsonb,            -- [{doc_id, doc_naam, similarity, chunk_preview}]
  extractie_output     text,             -- letterlijke output van extractie-call
  extractie_status     text,             -- "geverifieerd" | "niet_gevonden" | "skipped" | "error"
  extractie_latency_ms integer,
  totaal_latency_ms    integer,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fgl_diag_tenant_created ON public.fgl_diagnostics (tenant_id, created_at DESC);

-- RLS: alleen service role schrijft/leest, alsook teamleiders van dezelfde tenant.
ALTER TABLE public.fgl_diagnostics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fgl_diag_service_all" ON public.fgl_diagnostics;
CREATE POLICY "fgl_diag_service_all"
  ON public.fgl_diagnostics
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "fgl_diag_teamleider_read" ON public.fgl_diagnostics;
CREATE POLICY "fgl_diag_teamleider_read"
  ON public.fgl_diagnostics
  FOR SELECT
  USING (
    tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'teamleider')
  );

-- GRANTs (verplicht voor toegang via API):
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fgl_diagnostics TO anon, authenticated;

-- Retentie: 30 dagen. Aparte cleanup-functie; instelling via Supabase Dashboard cron
-- (in lijn met sluit_verlopen_inwerktrajecten).
CREATE OR REPLACE FUNCTION public.cleanup_fgl_diagnostics()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.fgl_diagnostics
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;

-- Cron: handmatig in te stellen via Supabase Dashboard > Database > Cron Jobs
-- Job naam: cleanup-fgl-diagnostics
-- Schedule: 0 4 * * *
-- Command: SELECT cleanup_fgl_diagnostics()
