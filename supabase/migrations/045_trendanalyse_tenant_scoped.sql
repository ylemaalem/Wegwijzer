-- =============================================
-- WEGWIJZER — Migratie 045
-- Trendanalyse rapporten: tenant-scoped i.p.v. per teamleider
-- Rapporten worden nu gedeeld binnen een organisatie:
-- elke teamleider in dezelfde tenant kan alle rapporten
-- inzien en verwijderen.
-- =============================================

-- Kolom teamleider_id blijft bestaan als audit-veld, maar niet meer verplicht
ALTER TABLE public.trendanalyse_rapporten
  ALTER COLUMN teamleider_id DROP NOT NULL;

-- Oude policies vervangen door tenant-scoped varianten
DROP POLICY IF EXISTS "teamleider_read_eigen_trendanalyse" ON public.trendanalyse_rapporten;
DROP POLICY IF EXISTS "teamleider_insert_eigen_trendanalyse" ON public.trendanalyse_rapporten;
DROP POLICY IF EXISTS "teamleider_delete_eigen_trendanalyse" ON public.trendanalyse_rapporten;

CREATE POLICY "tenant_read_trendanalyse"
  ON public.trendanalyse_rapporten FOR SELECT
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() IN ('teamleider', 'admin')
  );

CREATE POLICY "tenant_insert_trendanalyse"
  ON public.trendanalyse_rapporten FOR INSERT
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() IN ('teamleider', 'admin')
  );

CREATE POLICY "tenant_delete_trendanalyse"
  ON public.trendanalyse_rapporten FOR DELETE
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role() IN ('teamleider', 'admin')
  );
