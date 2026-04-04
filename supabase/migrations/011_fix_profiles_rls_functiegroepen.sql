-- =============================================
-- WEGWIJZER — Migratie 011
-- Fix RLS profiles, hernoem functiegroep, nieuwe functiegroepen
-- =============================================

-- 1. FIX: Teamleider profile policy (NULL-safe met COALESCE)
DROP POLICY IF EXISTS "teamleider_read_team_profiles" ON public.profiles;
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

-- 2. FIX: Teamleider conversations policy (NULL-safe met COALESCE)
DROP POLICY IF EXISTS "teamleider_read_team_conversations" ON public.conversations;
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

-- 3. Hernoem avond_nacht_begeleider naar medewerker_avond_nachtdienst
UPDATE public.profiles SET functiegroep = 'medewerker_avond_nachtdienst' WHERE functiegroep = 'avond_nacht_begeleider';

-- 4. Functiegroep constraint uitbreiden met alle nieuwe groepen
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_functiegroep_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_functiegroep_check
  CHECK (functiegroep IN (
    'ambulant_begeleider',
    'ambulant_persoonlijk_begeleider',
    'woonbegeleider',
    'persoonlijk_woonbegeleider',
    'medewerker_avond_nachtdienst',
    'kantoorpersoneel',
    'stagiaire',
    'zzp_uitzendkracht'
  ));
