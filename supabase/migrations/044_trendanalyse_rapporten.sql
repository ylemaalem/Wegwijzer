-- =============================================
-- WEGWIJZER — Migratie 044
-- Trendanalyse rapporten: geschiedenis van door teamleider gegenereerde analyses
-- =============================================

CREATE TABLE IF NOT EXISTS public.trendanalyse_rapporten (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  teamleider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tekst text NOT NULL,
  aangemaakt_op timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trendanalyse_tenant ON public.trendanalyse_rapporten(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trendanalyse_teamleider ON public.trendanalyse_rapporten(teamleider_id);

ALTER TABLE public.trendanalyse_rapporten ENABLE ROW LEVEL SECURITY;

-- Teamleider/admin mag eigen rapporten binnen tenant inzien
CREATE POLICY "teamleider_read_eigen_trendanalyse"
  ON public.trendanalyse_rapporten FOR SELECT
  USING (
    tenant_id = public.get_my_tenant_id()
    AND (
      public.get_my_role() = 'admin'
      OR teamleider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
  );

-- Teamleider/admin mag eigen rapporten inserten
CREATE POLICY "teamleider_insert_eigen_trendanalyse"
  ON public.trendanalyse_rapporten FOR INSERT
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND (
      public.get_my_role() = 'admin'
      OR teamleider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
  );

-- Teamleider/admin mag eigen rapporten verwijderen
CREATE POLICY "teamleider_delete_eigen_trendanalyse"
  ON public.trendanalyse_rapporten FOR DELETE
  USING (
    tenant_id = public.get_my_tenant_id()
    AND (
      public.get_my_role() = 'admin'
      OR teamleider_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    )
  );
