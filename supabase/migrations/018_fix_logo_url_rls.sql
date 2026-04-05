-- =============================================
-- WEGWIJZER — Migratie 018
-- Fix: logo_url toevoegen aan leesbare settings voor medewerkers
-- =============================================

-- Verwijder de oude policy
DROP POLICY IF EXISTS "medewerker_read_public_settings" ON public.settings;

-- Nieuwe policy met logo_url erbij
CREATE POLICY "medewerker_read_public_settings"
  ON public.settings
  FOR SELECT
  USING (
    tenant_id = public.get_my_tenant_id()
    AND sleutel IN ('disclaimer', 'organisatienaam', 'primaire_kleur', 'website_url', 'logo_url')
  );
