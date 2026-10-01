-- 083: uitnodigingsregister (stap 1 van 2 — vóór de Edge Function-deploy).
--
-- Probleem: publieke registratie staat aan (disable_signup = false) en
-- handle_new_user nam rol, naam en organisatie over uit user_metadata. Bij een
-- publieke aanmelding vult de aanmelder die metadata zelf in → iedereen met de
-- publieke anon key kon zich registreren als admin van elke organisatie.
-- auth.users.invited_at is geen bruikbaar onderscheid: GoTrue zet die pas ná
-- de INSERT (gemeten 30–70 ms later, na het aanmaken van het profiel).
--
-- Oplossing: de chat Edge Function (service role) legt elke uitnodiging vast in
-- dit register vóór inviteUserByEmail. handle_new_user (migratie 084) maakt
-- alleen een profiel aan als er een openstaande uitnodiging voor dat e-mailadres
-- is, met rol/naam/organisatie uit het register — niet uit user_metadata.

CREATE TABLE IF NOT EXISTS public.uitnodigingen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  naam text,
  role text NOT NULL DEFAULT 'medewerker' CHECK (role IN ('admin', 'medewerker', 'teamleider')),
  functiegroep text,
  afdeling text,
  aangemaakt_door uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  gebruikt_op timestamptz
);

CREATE INDEX IF NOT EXISTS idx_uitnodigingen_email ON public.uitnodigingen (lower(email), created_at DESC);

ALTER TABLE public.uitnodigingen ENABLE ROW LEVEL SECURITY;

-- Schrijven alleen door de Edge Function (service role, omzeilt RLS).
-- Admins mogen de uitnodigingen van de eigen organisatie inzien.
DROP POLICY IF EXISTS admin_lees_uitnodigingen ON public.uitnodigingen;
CREATE POLICY admin_lees_uitnodigingen ON public.uitnodigingen
  FOR SELECT TO authenticated
  USING ((get_my_role() = 'admin' AND tenant_id = get_my_tenant_id()) OR is_superadmin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.uitnodigingen TO anon, authenticated;
