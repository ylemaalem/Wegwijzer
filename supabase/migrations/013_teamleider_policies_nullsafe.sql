-- =============================================
-- WEGWIJZER — Migratie 013
-- NULL-safe teamleider RLS policies
-- Raakt GEEN bestaande admin/medewerker policies aan
-- =============================================

-- Verwijder eventuele restanten van eerdere pogingen
DROP POLICY IF EXISTS "teamleider_read_team_profiles" ON public.profiles;
DROP POLICY IF EXISTS "teamleider_read_team_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_insert_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_update_own_feedback" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_read_meldingen" ON public.meldingen;
DROP POLICY IF EXISTS "teamleider_read_settings" ON public.settings;
DROP POLICY IF EXISTS "teamleider_read_teamleiders" ON public.teamleiders;

-- 1. Teamleider ziet eigen profiel + profielen met overlappende teams
CREATE POLICY "teamleider_read_team_profiles"
  ON public.profiles FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
    AND (
      user_id = auth.uid()
      OR COALESCE(teams, '{}') && COALESCE(
        (SELECT p.teams FROM public.profiles p WHERE p.user_id = auth.uid()),
        '{}'
      )
    )
  );

-- 2. Teamleider ziet eigen gesprekken + gesprekken van teamleden
CREATE POLICY "teamleider_read_team_conversations"
  ON public.conversations FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
    AND (
      user_id = public.get_my_profile_id()
      OR user_id IN (
        SELECT p.id FROM public.profiles p
        WHERE p.tenant_id = public.get_my_tenant_id()
        AND COALESCE(p.teams, '{}') && COALESCE(
          (SELECT p2.teams FROM public.profiles p2 WHERE p2.user_id = auth.uid()),
          '{}'
        )
      )
    )
  );

-- 3. Teamleider kan eigen gesprekken aanmaken (chatbot)
CREATE POLICY "teamleider_insert_conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
    AND tenant_id = public.get_my_tenant_id()
  );

-- 4. Teamleider kan eigen feedback geven
CREATE POLICY "teamleider_update_own_feedback"
  ON public.conversations FOR UPDATE
  USING (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
  );

-- 5. Teamleider ziet meldingen
CREATE POLICY "teamleider_read_meldingen"
  ON public.meldingen FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 6. Teamleider leest instellingen
CREATE POLICY "teamleider_read_settings"
  ON public.settings FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 7. Teamleider leest teamleiders
CREATE POLICY "teamleider_read_teamleiders"
  ON public.teamleiders FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );
