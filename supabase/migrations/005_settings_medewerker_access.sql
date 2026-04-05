-- =============================================
-- Uitbreiding: medewerkers mogen ook organisatienaam,
-- primaire_kleur en website_url lezen
-- Plak dit in Supabase SQL Editor en klik Run
-- =============================================

-- Verwijder de oude restrictieve policy
DROP POLICY IF EXISTS "medewerker_read_disclaimer" ON public.settings;

-- Nieuwe policy: medewerker kan publieke instellingen lezen
CREATE POLICY "medewerker_read_public_settings"
  ON public.settings
  FOR SELECT
  USING (
    tenant_id = public.get_my_tenant_id()
    AND sleutel IN ('disclaimer', 'organisatienaam', 'primaire_kleur', 'website_url', 'logo_url')
  );
