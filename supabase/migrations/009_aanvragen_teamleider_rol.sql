-- =============================================
-- WEGWIJZER — Migratie 009
-- Aanvragen tabel, teamleider rol
-- =============================================

-- 1. Role check uitbreiden voor teamleider
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'medewerker', 'teamleider'));

-- 2. Aanvragen tabel
CREATE TABLE IF NOT EXISTS public.aanvragen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'nieuw' CHECK (type IN ('nieuw', 'verwijder')),
  status text NOT NULL DEFAULT 'in_afwachting' CHECK (status IN ('in_afwachting', 'goedgekeurd', 'afgekeurd')),
  -- Aanvrager (teamleider)
  aangevraagd_door uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  aanvrager_naam text,
  -- Gegevens nieuwe medewerker
  medewerker_naam text,
  medewerker_email text,
  medewerker_functiegroep text,
  medewerker_team text,
  medewerker_startdatum date,
  medewerker_werkuren text,
  medewerker_regio text,
  -- Bij verwijderaanvraag
  medewerker_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Afhandeling
  afkeurreden text,
  behandeld_op timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aanvragen_tenant ON public.aanvragen(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aanvragen_status ON public.aanvragen(status);

-- RLS
ALTER TABLE public.aanvragen ENABLE ROW LEVEL SECURITY;

-- Admin leest alle aanvragen
CREATE POLICY "admin_read_aanvragen"
  ON public.aanvragen FOR SELECT
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- Admin kan status updaten
CREATE POLICY "admin_update_aanvragen"
  ON public.aanvragen FOR UPDATE
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- Teamleider kan aanvragen lezen die hij heeft ingediend
CREATE POLICY "teamleider_read_own_aanvragen"
  ON public.aanvragen FOR SELECT
  USING (aangevraagd_door = public.get_my_profile_id());

-- Teamleider kan nieuwe aanvragen indienen
CREATE POLICY "teamleider_insert_aanvragen"
  ON public.aanvragen FOR INSERT
  WITH CHECK (
    (public.get_my_role() = 'teamleider' OR public.get_my_role() = 'admin')
    AND tenant_id = public.get_my_tenant_id()
  );

-- 3. Teamleider RLS policies (NULL-safe met COALESCE)
-- Teamleider ziet eigen profiel + profielen met overlappende teams
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

-- Teamleider ziet eigen gesprekken + gesprekken van teamleden
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

-- Teamleider kan eigen gesprekken aanmaken (chatbot)
CREATE POLICY "teamleider_insert_conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
    AND tenant_id = public.get_my_tenant_id()
  );

-- Teamleider kan eigen feedback geven
CREATE POLICY "teamleider_update_own_feedback"
  ON public.conversations FOR UPDATE
  USING (
    public.get_my_role() = 'teamleider'
    AND user_id = public.get_my_profile_id()
  );

-- Teamleider ziet meldingen
CREATE POLICY "teamleider_read_meldingen"
  ON public.meldingen FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Teamleider leest settings
CREATE POLICY "teamleider_read_settings"
  ON public.settings FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Teamleider leest teamleiders tabel
CREATE POLICY "teamleider_read_teamleiders"
  ON public.teamleiders FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND tenant_id = public.get_my_tenant_id()
  );

-- 4. Versienummer kolom verwijderen (Opdracht 8)
ALTER TABLE public.documents DROP COLUMN IF EXISTS versienummer;
