-- 077: regressie-testset (stap 1) — tabellen voor vragen en runs.
-- De vragen komen uit tests/regressie_testset.json (los ter review). De runner
-- draait in de chat Edge Function (testmodus) en schrijft een run weg. Verificatie
-- is een stringcheck op 'kernfeit' — geen AI-call, dus geen extra kosten.

CREATE TABLE IF NOT EXISTS public.regressie_vragen (
  id integer PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  categorie text,
  vraag text NOT NULL,
  functiegroep text,
  teams text[] NOT NULL DEFAULT '{}',
  kernfeit text[] NOT NULL DEFAULT '{}',
  alle boolean NOT NULL DEFAULT false,   -- true = alle kernfeiten vereist; false = minstens één
  bron text,
  actief boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.regressie_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  gestart_op timestamptz NOT NULL DEFAULT now(),
  aantal_vragen integer NOT NULL DEFAULT 0,
  geslaagd integer NOT NULL DEFAULT 0,
  gefaald integer NOT NULL DEFAULT 0,
  tokens_input integer NOT NULL DEFAULT 0,
  tokens_output integer NOT NULL DEFAULT 0,
  kosten_usd numeric(10,4) NOT NULL DEFAULT 0,
  trigger text NOT NULL DEFAULT 'handmatig',   -- 'handmatig' | 'cron'
  details jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_regressie_runs_tenant ON public.regressie_runs (tenant_id, gestart_op DESC);

ALTER TABLE public.regressie_vragen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regressie_runs ENABLE ROW LEVEL SECURITY;

-- Alleen admins van de eigen organisatie mogen de testset en runs zien/beheren.
-- Schrijven van runs gebeurt door de Edge Function (service role, omzeilt RLS).
DROP POLICY IF EXISTS regressie_vragen_admin ON public.regressie_vragen;
CREATE POLICY regressie_vragen_admin ON public.regressie_vragen
  FOR ALL TO authenticated
  USING ((get_my_role() = 'admin' AND tenant_id = get_my_tenant_id()) OR is_superadmin())
  WITH CHECK ((get_my_role() = 'admin' AND tenant_id = get_my_tenant_id()) OR is_superadmin());

DROP POLICY IF EXISTS regressie_runs_admin_lezen ON public.regressie_runs;
CREATE POLICY regressie_runs_admin_lezen ON public.regressie_runs
  FOR SELECT TO authenticated
  USING ((get_my_role() = 'admin' AND tenant_id = get_my_tenant_id()) OR is_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.regressie_vragen TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.regressie_runs TO anon, authenticated;
