-- =============================================
-- WEGWIJZER — Migratie 051
-- 1. meldingen krijgt team + medewerker_profile_id zodat de
--    teamleider weet welk team en welke (anonieme) trigger,
--    en zodat naam-ontsluiting via Edge Function de juiste
--    medewerker kan vinden.
-- 2. incident_naam_ontsluiting: log van elke ontsluiting door
--    een teamleider. Alleen admin mag deze tabel inzien.
-- 3. profiles.laatste_actief: timestamp van laatste chatbot-vraag.
--    Edge Function update dit bij elke succesvolle chat.
-- =============================================

-- 1. meldingen uitbreiden ----------------------------------------
ALTER TABLE public.meldingen
  ADD COLUMN IF NOT EXISTS team text;

ALTER TABLE public.meldingen
  ADD COLUMN IF NOT EXISTS medewerker_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meldingen_team ON public.meldingen (team);

-- 2. incident_naam_ontsluiting -----------------------------------
CREATE TABLE IF NOT EXISTS public.incident_naam_ontsluiting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  teamleider_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  melding_id uuid REFERENCES public.meldingen(id) ON DELETE SET NULL,
  medewerker_naam text NOT NULL,
  ontsloten_op timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_no_tenant ON public.incident_naam_ontsluiting (tenant_id);
CREATE INDEX IF NOT EXISTS idx_incident_no_tl ON public.incident_naam_ontsluiting (teamleider_id);

ALTER TABLE public.incident_naam_ontsluiting ENABLE ROW LEVEL SECURITY;

-- Alleen admin (van eigen tenant) mag log inzien
CREATE POLICY "admin_read_incident_no"
  ON public.incident_naam_ontsluiting FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- INSERT komt via Edge Function (service_role) → bypasst RLS.
-- Geen INSERT-policy voor authenticated rollen, zodat teamleiders
-- niet handmatig log-rijen kunnen vervalsen.

-- Superadmin
DROP POLICY IF EXISTS "superadmin_full" ON public.incident_naam_ontsluiting;
CREATE POLICY "superadmin_full" ON public.incident_naam_ontsluiting
  FOR ALL
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- 3. profiles.laatste_actief -------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS laatste_actief timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_laatste_actief ON public.profiles (laatste_actief);
