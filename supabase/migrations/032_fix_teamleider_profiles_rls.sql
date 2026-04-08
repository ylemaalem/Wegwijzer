-- =============================================
-- WEGWIJZER — Migratie 032
-- FIX: Teamleider kan profielen lezen in eigen tenant
-- Probleem: teamleider ziet maar 1 medewerker (eigen profiel)
-- =============================================

-- Verwijder bestaande policy als die er al is
DROP POLICY IF EXISTS "teamleider_lees_tenant" ON public.profiles;

-- Maak de policy opnieuw aan
-- Teamleider kan alle profielen in eigen tenant lezen
CREATE POLICY "teamleider_lees_tenant"
  ON public.profiles FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Zorg dat RLS aanstaat
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
