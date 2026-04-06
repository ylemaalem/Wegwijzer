-- =============================================
-- WEGWIJZER — Migratie 022
-- Teamleider mag alle tenant conversations lezen
-- =============================================

-- Verwijder de restrictieve eigen-conversations policy
DROP POLICY IF EXISTS "teamleider_eigen_conversations" ON public.conversations;

-- Teamleider mag alle gesprekken in eigen tenant lezen
CREATE POLICY "teamleider_lees_tenant_conversations"
  ON public.conversations FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Teamleider mag eigen gesprekken aanmaken en bewerken
CREATE POLICY "teamleider_write_own_conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
    AND tenant_id = public.get_my_tenant_id()
  );

CREATE POLICY "teamleider_update_own_conversations"
  ON public.conversations FOR UPDATE
  USING (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
  );
