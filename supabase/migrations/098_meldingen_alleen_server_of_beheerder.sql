-- Meldingen (signalen voor leidinggevenden) mochten door iedereen in de organisatie
-- worden aangemaakt (service_insert_meldingen: alleen tenant_id = eigen organisatie).
-- De app maakt meldingen alleen aan via de chatfunctie (service-rol, buiten RLS).
-- Vanaf nu: alleen de server of een beheerder van de eigen organisatie.
-- Test: tests/sql/rechtenmatrix_leidinggevende.sql (kolom meldingen).

DROP POLICY IF EXISTS service_insert_meldingen ON public.meldingen;
CREATE POLICY admin_insert_meldingen ON public.meldingen FOR INSERT
  WITH CHECK (get_my_role() = 'admin' AND tenant_id = get_my_tenant_id());
