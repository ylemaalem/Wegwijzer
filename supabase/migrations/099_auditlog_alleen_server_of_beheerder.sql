-- Het auditlog kon door elke ingelogde gebruiker (en in principe anoniem) worden
-- aangevuld: policy "Service role schrijft audit log" had WITH CHECK (true) voor
-- iedereen. De server (service-rol) en SECURITY DEFINER-functies staan buiten RLS.
-- Vanaf nu: alleen een beheerder van de eigen organisatie, en alleen op eigen naam
-- (user_id = het eigen account), zodat niemand regels namens een ander schrijft.
-- Test: tests/sql/rechtenmatrix_leidinggevende.sql (kolom audit_log).

DROP POLICY IF EXISTS "Service role schrijft audit log" ON public.audit_log;
CREATE POLICY admin_schrijft_audit_log ON public.audit_log FOR INSERT
  WITH CHECK (get_my_role() = 'admin' AND tenant_id = get_my_tenant_id() AND user_id = auth.uid());
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM anon;
