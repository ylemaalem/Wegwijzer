-- =============================================
-- WEGWIJZER — Migratie 042
-- Superadmin (Wegwijzer Beheer) — kan alle tenants beheren via
-- de organisatie-switcher in de admin header.
--
-- Strategie: SECURITY DEFINER functie is_superadmin() detecteert
-- of de huidige auth.uid() een profile heeft met naam =
-- 'Wegwijzer Beheer' EN role = 'admin'. Voor elke admin-relevant
-- tabel een aparte FOR ALL policy "superadmin_full" die alleen
-- doorlaat als is_superadmin() = true — staat los van de bestaande
-- admin/teamleider/medewerker policies.
-- =============================================

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND role = 'admin'
      AND naam = 'Wegwijzer Beheer'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_superadmin() TO anon, authenticated;

-- Helper macro: doe per tabel hetzelfde via een DO block
DO $$
DECLARE
  tabel text;
  tabellen text[] := ARRAY[
    'tenants', 'profiles', 'conversations',
    'documents', 'document_mappen', 'document_aanvragen',
    'kennisbank_items', 'kennisnotities', 'kennissuggesties',
    'kenniskloof_meldingen',
    'meldingen', 'aanvragen', 'app_feedback',
    'vertrouwens_scores', 'quiz_resultaten',
    'terugblik_log', 'rapporten',
    'privacy_verzoeken', 'toegestane_websites',
    'teamleiders', 'functiegroepen', 'functie_historie',
    'settings', 'weekstart_briefings', 'rate_extensions'
  ];
BEGIN
  FOREACH tabel IN ARRAY tabellen LOOP
    EXECUTE format('DROP POLICY IF EXISTS "superadmin_full" ON public.%I', tabel);
    EXECUTE format(
      'CREATE POLICY "superadmin_full" ON public.%I FOR ALL USING (public.is_superadmin()) WITH CHECK (public.is_superadmin())',
      tabel
    );
  END LOOP;
END $$;

-- Tenants: superadmin moet ook nieuwe tenants kunnen INSERTen.
-- De FOR ALL hierboven dekt dat (USING + WITH CHECK = is_superadmin()).
