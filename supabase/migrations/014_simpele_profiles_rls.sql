-- =============================================
-- WEGWIJZER — Migratie 014
-- DEFINITIEVE FIX: Simpele profiles RLS zonder subqueries
-- =============================================

-- STAP 1: Verwijder ALLE bestaande policies op profiles
DROP POLICY IF EXISTS "medewerker_read_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "admin_read_tenant_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admin_insert_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admin_update_profiles" ON public.profiles;
DROP POLICY IF EXISTS "admin_delete_profiles" ON public.profiles;
DROP POLICY IF EXISTS "teamleider_read_team_profiles" ON public.profiles;

-- STAP 2: Maak 2 simpele policies — geen subqueries op profiles zelf
-- Iedereen ziet eigen profiel
CREATE POLICY "eigen_profiel"
  ON public.profiles FOR ALL
  USING (user_id = auth.uid());

-- Admin ziet en beheert alle profielen in eigen tenant
CREATE POLICY "admin_alles"
  ON public.profiles FOR ALL
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Teamleider kan profielen lezen in eigen tenant (filteren op teams doet de frontend)
CREATE POLICY "teamleider_lees_tenant"
  ON public.profiles FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- STAP 3: Verwijder teamleider policies op conversations die subqueries op profiles doen
DROP POLICY IF EXISTS "teamleider_read_team_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_insert_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_update_own_feedback" ON public.conversations;

-- Teamleider: eigen gesprekken lezen/schrijven (geen subquery op profiles)
CREATE POLICY "teamleider_eigen_conversations"
  ON public.conversations FOR ALL
  USING (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
    AND tenant_id = public.get_my_tenant_id()
  );

-- STAP 4: Zorg dat RLS aanstaat
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
