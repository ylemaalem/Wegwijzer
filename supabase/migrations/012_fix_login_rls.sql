-- =============================================
-- WEGWIJZER — Migratie 012
-- KRITIEKE FIX: Inlogprobleem oplossen
-- =============================================

-- STAP 1: Verwijder de problematische teamleider policy op profiles
DROP POLICY IF EXISTS "teamleider_read_team_profiles" ON public.profiles;

-- STAP 2: Verwijder ook de conversations policy die hetzelfde probleem heeft
DROP POLICY IF EXISTS "teamleider_read_team_conversations" ON public.conversations;

-- STAP 3: Maak een veilige teamleider profile policy
-- Deze crasht NIET bij NULL teams
CREATE POLICY "teamleider_read_team_profiles"
  ON public.profiles FOR SELECT
  USING (
    -- Eigen profiel altijd zichtbaar
    user_id = auth.uid()
    OR (
      -- Admin ziet alles in eigen tenant (bestaande policy dekt dit al, maar voor de zekerheid)
      public.get_my_role() = 'admin'
      AND tenant_id = public.get_my_tenant_id()
    )
    OR (
      -- Teamleider ziet teamleden, maar alleen als BEIDE teams arrays niet NULL zijn
      public.get_my_role() = 'teamleider'
      AND tenant_id = public.get_my_tenant_id()
      AND teams IS NOT NULL
      AND array_length(teams, 1) > 0
      AND EXISTS (
        SELECT 1 FROM public.profiles p2
        WHERE p2.user_id = auth.uid()
        AND p2.teams IS NOT NULL
        AND p2.teams && teams
      )
    )
  );

-- STAP 4: Veilige teamleider conversations policy
CREATE POLICY "teamleider_read_team_conversations"
  ON public.conversations FOR SELECT
  USING (
    -- Eigen gesprekken
    user_id = public.get_my_profile_id()
    OR (
      -- Admin ziet alles (bestaande policy dekt dit al)
      public.get_my_role() = 'admin'
      AND tenant_id = public.get_my_tenant_id()
    )
    OR (
      -- Teamleider ziet gesprekken van teamleden
      public.get_my_role() = 'teamleider'
      AND tenant_id = public.get_my_tenant_id()
      AND user_id IN (
        SELECT p.id FROM public.profiles p
        WHERE p.tenant_id = public.get_my_tenant_id()
        AND p.teams IS NOT NULL
        AND array_length(p.teams, 1) > 0
        AND EXISTS (
          SELECT 1 FROM public.profiles p2
          WHERE p2.user_id = auth.uid()
          AND p2.teams IS NOT NULL
          AND p2.teams && p.teams
        )
      )
    )
  );
