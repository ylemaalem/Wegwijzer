-- =============================================
-- WEGWIJZER — Migratie 049
-- Fix: teamleider_lees_conversations policy uit migratie 047
-- refereerde auth.users vanuit RLS. Daardoor checkt Postgres
-- bij elke SELECT op conversations (óók als admin) permissies
-- op auth.users, wat faalt voor role 'authenticated'
-- ("permission denied for table users").
--
-- Oplossing: SECURITY DEFINER helper get_my_teamleider_teams()
-- kapselt de auth.users-join in, zodat de policy zelf geen
-- directe referentie meer heeft naar auth.users.
-- =============================================

CREATE OR REPLACE FUNCTION public.get_my_teamleider_teams()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tl.teams
  FROM public.teamleiders tl
  INNER JOIN auth.users u ON u.email = tl.email
  WHERE u.id = auth.uid()
    AND tl.tenant_id = public.get_my_tenant_id()
    AND tl.teams IS NOT NULL
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_teamleider_teams() TO authenticated;

-- Herdefinieer policy zonder auth.users-join
DROP POLICY IF EXISTS teamleider_lees_conversations ON public.conversations;

CREATE POLICY teamleider_lees_conversations
  ON public.conversations FOR SELECT
  USING (
    get_my_role() = 'teamleider'
    AND tenant_id = get_my_tenant_id()
    AND user_id IN (
      SELECT p.id FROM public.profiles p
      WHERE p.tenant_id = get_my_tenant_id()
        AND p.teams && public.get_my_teamleider_teams()
    )
  );
