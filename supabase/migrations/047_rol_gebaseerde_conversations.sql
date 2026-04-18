-- =============================================
-- WEGWIJZER — Migratie 047
-- Rol-gebaseerde RLS op conversations:
-- - Teamleider ziet alleen gesprekken van medewerkers
--   waarvan profile.teams overlapt met eigen teamleiders.teams.
-- - Manager/HR (teamleiders.rol in ('manager','hr'), teams = null)
--   zien via deze policy NIETS — blokkeert gespreksinhoud voor
--   hele-organisatie rollen zoals gespecificeerd.
-- =============================================

DROP POLICY IF EXISTS teamleider_lees_tenant_conversations
  ON public.conversations;

CREATE POLICY teamleider_lees_conversations
  ON public.conversations FOR SELECT
  USING (
    get_my_role() = 'teamleider'
    AND tenant_id = get_my_tenant_id()
    AND user_id IN (
      SELECT p.id FROM public.profiles p
      WHERE p.tenant_id = get_my_tenant_id()
      AND p.teams && (
        SELECT tl.teams
        FROM public.teamleiders tl
        INNER JOIN auth.users u ON u.email = tl.email
        WHERE u.id = auth.uid()
        AND tl.tenant_id = get_my_tenant_id()
        AND tl.teams IS NOT NULL
        LIMIT 1
      )
    )
  );
