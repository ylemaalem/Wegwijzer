-- =============================================
-- WEGWIJZER — Migratie 023
-- Fix: teamleider conversations policies opnieuw aanmaken
-- Verwijdert eerst alle bestaande teamleider policies op conversations
-- =============================================

-- Stap 1: Verwijder ALLE mogelijke teamleider policies op conversations
DROP POLICY IF EXISTS "teamleider_eigen_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_lees_tenant_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_write_own_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_update_own_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_read_team_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_insert_conversations" ON public.conversations;
DROP POLICY IF EXISTS "teamleider_update_own_feedback" ON public.conversations;

-- Stap 2: Maak schone policies aan
-- Lezen: alle gesprekken in eigen tenant
CREATE POLICY "teamleider_lees_tenant_conversations"
  ON public.conversations FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Schrijven: eigen gesprekken aanmaken
CREATE POLICY "teamleider_write_own_conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
    AND tenant_id = public.get_my_tenant_id()
  );

-- Updaten: eigen feedback
CREATE POLICY "teamleider_update_own_conversations"
  ON public.conversations FOR UPDATE
  USING (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
  );
