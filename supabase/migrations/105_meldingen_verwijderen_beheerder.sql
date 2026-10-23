-- Beheerders mogen meldingen van de eigen organisatie verwijderen (2026-10-23).
-- Tot nu toe kon alleen de superadmin dat (superadmin_full); de 🗑️-knop in Beheer
-- deed bij een gewone beheerder stil niets. Andere rollen blijven niets verwijderen.
-- incident_naam_ontsluiting.melding_id wordt bij verwijderen NULL (bestaande FK).
-- Test: tests/sql/meldingen_verwijderen.sql
CREATE POLICY admin_delete_meldingen ON public.meldingen FOR DELETE TO authenticated
  USING ((SELECT public.get_my_role()) = 'admin' AND tenant_id = (SELECT public.get_my_tenant_id()));
