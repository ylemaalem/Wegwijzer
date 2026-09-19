-- =============================================
-- WEGWIJZER — Migratie 073
-- Functie-hardening (5B): vaste search_path + onnodige EXECUTE-rechten intrekken
-- =============================================
-- search_path: gemeten dat anon/authenticated geen CREATE-recht hebben op public,
-- extensions of auth — de search_path-aanval is nu dus niet uitvoerbaar. Dit is
-- hygiëne die een latent escalatiepad wegneemt: get_my_role/get_my_tenant_id/
-- get_my_profile_id dragen de hele RLS. Alle acht bodies verwijzen alleen naar
-- public.*, auth.uid() (gekwalificeerd) of pg_catalog — search_path=public is veilig.
-- De get_my_*-functies zijn al SECURITY DEFINER en werden dus al niet ge-inlined;
-- de SET-clausule heeft geen performance-effect op RLS.
--
-- EXECUTE intrekken: cleanup_fgl_diagnostics en sluit_verlopen_inwerktrajecten
-- hebben geen enkele app-aanroep (alleen cron, die als eigenaar draait). Ze zijn
-- geen SECURITY DEFINER, dus RLS gold al — maar ze horen niet via de API
-- aanroepbaar te zijn. Postgres geeft standaard EXECUTE aan PUBLIC; daarom ook
-- van PUBLIC intrekken, anders blijft anon het recht via PUBLIC houden.
-- =============================================

BEGIN;

ALTER FUNCTION public.update_kennisbank_updated_at()     SET search_path = public;
ALTER FUNCTION public.increment_gebruikt_count(uuid)    SET search_path = public;
ALTER FUNCTION public.get_my_tenant_id()                SET search_path = public;
ALTER FUNCTION public.get_my_role()                     SET search_path = public;
ALTER FUNCTION public.get_my_profile_id()               SET search_path = public;
ALTER FUNCTION public.sluit_verlopen_inwerktrajecten()  SET search_path = public;
ALTER FUNCTION public.cleanup_fgl_diagnostics()         SET search_path = public;
ALTER FUNCTION public.seed_nieuwe_tenant(uuid)          SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.cleanup_fgl_diagnostics()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sluit_verlopen_inwerktrajecten() FROM PUBLIC, anon, authenticated;

COMMIT;
