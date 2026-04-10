-- =============================================
-- WEGWIJZER — Migratie 039
-- Kennissuggesties: ontbrekende admin RLS policy herstellen
-- (uit migratie 036; policy ontbreekt in DB — RLS=on, 0 policies)
-- =============================================

DROP POLICY IF EXISTS "admin_crud_kennissuggesties" ON public.kennissuggesties;
CREATE POLICY "admin_crud_kennissuggesties"
  ON public.kennissuggesties FOR ALL
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id())
  WITH CHECK (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());
