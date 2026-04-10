-- =============================================
-- WEGWIJZER — Migratie 038
-- Admin mag conversations updaten/deleten in eigen tenant
-- (nodig voor "Verbeterpunt verwijderen": resetten van negatieve feedback)
-- =============================================

DROP POLICY IF EXISTS "admin_update_tenant_conversations" ON public.conversations;
CREATE POLICY "admin_update_tenant_conversations"
  ON public.conversations FOR UPDATE
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

DROP POLICY IF EXISTS "admin_delete_tenant_conversations" ON public.conversations;
CREATE POLICY "admin_delete_tenant_conversations"
  ON public.conversations FOR DELETE
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );
