-- =============================================
-- WEGWIJZER — Migratie 017
-- Rapport delete policy, feedback timestamp
-- =============================================

-- 1. Admin mag rapporten verwijderen
CREATE POLICY "admin_delete_rapporten"
  ON public.rapporten FOR DELETE
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- 2. Feedback timestamp voor 10 minuten wijzigingsperiode
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS feedback_op timestamptz;
