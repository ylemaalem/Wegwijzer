-- Beveiligingslek 2026-10-23: een profiel met role 'teamleider' maar ZONDER rij in
-- teamleiders kreeg het dashboard en leesrechten (en schrijfrechten op de
-- onboarding-checklist) voor de hele organisatie, omdat de regels alleen naar
-- profiles.role keken. Vanaf nu telt iemand alleen als leidinggevende als er een
-- teamleiders-rij is met zijn e-mailadres in de eigen organisatie.
-- Test: tests/sql/rechtenmatrix_leidinggevende.sql (teruggedraaide transactie).

-- ---------------------------------------------------------------------------
-- 1. Controlefuncties
-- ---------------------------------------------------------------------------

-- Rol uit teamleiders ('teamleider', 'manager' of 'hr') van een account, of NULL
-- als het profiel geen role 'teamleider' heeft of er geen rij in de eigen
-- organisatie is. Het e-mailadres komt uit auth.users (niet uit profiles), zodat
-- niemand zich via een profielveld een rij kan toe-eigenen.
CREATE OR REPLACE FUNCTION public.leidinggevende_rol_van(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(t.rol, 'teamleider')
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.user_id
    JOIN public.teamleiders t
      ON t.tenant_id = p.tenant_id
     AND lower(btrim(t.email)) = lower(btrim(u.email))
   WHERE p.user_id = p_user
     AND p.role = 'teamleider'
   ORDER BY t.created_at
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.leidinggevende_rol_van(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leidinggevende_rol_van(uuid) TO service_role;

-- Hetzelfde voor de ingelogde persoon; voor gebruik in de databaseregels en in de app.
CREATE OR REPLACE FUNCTION public.mijn_leidinggevende_rol()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.leidinggevende_rol_van(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.mijn_leidinggevende_rol() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mijn_leidinggevende_rol() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Rij weg (of ander e-mailadres): profiel terug naar 'medewerker' + auditlog
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.intrek_leidinggevende_rol()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profiel record;
  v_uitvoerder_email text;
  v_uitvoerder_naam text;
BEGIN
  IF OLD.email IS NULL OR btrim(OLD.email) = '' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND lower(btrim(COALESCE(NEW.email, ''))) = lower(btrim(OLD.email))
     AND NEW.tenant_id = OLD.tenant_id THEN
    RETURN NULL;
  END IF;
  -- Staat dit adres nog in een andere rij van dezelfde organisatie? Dan blijft de rol.
  IF EXISTS (SELECT 1 FROM public.teamleiders t
              WHERE t.tenant_id = OLD.tenant_id
                AND lower(btrim(t.email)) = lower(btrim(OLD.email))) THEN
    RETURN NULL;
  END IF;

  SELECT u.email, p.naam INTO v_uitvoerder_email, v_uitvoerder_naam
    FROM auth.users u LEFT JOIN public.profiles p ON p.user_id = u.id
   WHERE u.id = auth.uid();

  -- Nooit een admin terugzetten: alleen role 'teamleider' wordt 'medewerker'.
  FOR v_profiel IN
    UPDATE public.profiles p
       SET role = 'medewerker'
     WHERE p.tenant_id = OLD.tenant_id
       AND lower(btrim(p.email)) = lower(btrim(OLD.email))
       AND p.role = 'teamleider'
    RETURNING p.id, p.email, p.naam
  LOOP
    INSERT INTO public.audit_log (tenant_id, user_id, user_email, user_naam, actie, object_type, object_id, details)
    VALUES (OLD.tenant_id, auth.uid(), v_uitvoerder_email, v_uitvoerder_naam,
            'LEIDINGGEVENDE_ROL_INGETROKKEN', 'medewerker', v_profiel.id,
            jsonb_build_object('email', v_profiel.email, 'naam', v_profiel.naam,
                               'oude_rol', 'teamleider', 'nieuwe_rol', 'medewerker',
                               'teamleider_rij', OLD.id, 'leidinggevende_naam', OLD.naam,
                               'reden', CASE WHEN TG_OP = 'DELETE' THEN 'leidinggevende verwijderd'
                                             ELSE 'e-mailadres van de leidinggevende gewijzigd' END));
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.intrek_leidinggevende_rol() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS teamleiders_intrek_rol ON public.teamleiders;
CREATE TRIGGER teamleiders_intrek_rol
  AFTER DELETE OR UPDATE OF email, tenant_id ON public.teamleiders
  FOR EACH ROW EXECUTE FUNCTION public.intrek_leidinggevende_rol();

-- ---------------------------------------------------------------------------
-- 3. Databaseregels: role 'teamleider' alleen geldig met een rij
-- ---------------------------------------------------------------------------
-- (SELECT ...) zodat de functie één keer per query wordt uitgerekend, niet per rij.

-- profiles
DROP POLICY IF EXISTS teamleider_lees_tenant ON public.profiles;
CREATE POLICY teamleider_lees_tenant ON public.profiles FOR SELECT
  USING ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND tenant_id = get_my_tenant_id());

-- meldingen
DROP POLICY IF EXISTS teamleider_read_meldingen ON public.meldingen;
CREATE POLICY teamleider_read_meldingen ON public.meldingen FOR SELECT
  USING ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND tenant_id = get_my_tenant_id());

-- vertrouwens_scores
DROP POLICY IF EXISTS teamleider_read_gedeelde_scores ON public.vertrouwens_scores;
CREATE POLICY teamleider_read_gedeelde_scores ON public.vertrouwens_scores FOR SELECT
  USING ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND gedeeld = true AND tenant_id = get_my_tenant_id());

-- quiz_resultaten
DROP POLICY IF EXISTS teamleider_read_gedeelde_quiz ON public.quiz_resultaten;
CREATE POLICY teamleider_read_gedeelde_quiz ON public.quiz_resultaten FOR SELECT
  USING ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND gedeeld = true AND tenant_id = get_my_tenant_id());

-- settings
DROP POLICY IF EXISTS teamleider_read_settings ON public.settings;
CREATE POLICY teamleider_read_settings ON public.settings FOR SELECT
  USING ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND tenant_id = get_my_tenant_id());

-- teamleiders (admin_read_teamleiders blijft: iedereen in de organisatie ziet de
-- leidinggevenden, o.a. als contactpersoon)
DROP POLICY IF EXISTS teamleider_read_teamleiders ON public.teamleiders;
CREATE POLICY teamleider_read_teamleiders ON public.teamleiders FOR SELECT
  USING ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND tenant_id = get_my_tenant_id());

-- trendanalyse_rapporten
DROP POLICY IF EXISTS tenant_read_trendanalyse ON public.trendanalyse_rapporten;
CREATE POLICY tenant_read_trendanalyse ON public.trendanalyse_rapporten FOR SELECT
  USING (tenant_id = get_my_tenant_id()
         AND (get_my_role() = 'admin' OR (SELECT public.mijn_leidinggevende_rol()) IS NOT NULL));
DROP POLICY IF EXISTS tenant_insert_trendanalyse ON public.trendanalyse_rapporten;
CREATE POLICY tenant_insert_trendanalyse ON public.trendanalyse_rapporten FOR INSERT
  WITH CHECK (tenant_id = get_my_tenant_id()
              AND (get_my_role() = 'admin' OR (SELECT public.mijn_leidinggevende_rol()) IS NOT NULL));
DROP POLICY IF EXISTS tenant_delete_trendanalyse ON public.trendanalyse_rapporten;
CREATE POLICY tenant_delete_trendanalyse ON public.trendanalyse_rapporten FOR DELETE
  USING (tenant_id = get_my_tenant_id()
         AND (get_my_role() = 'admin' OR (SELECT public.mijn_leidinggevende_rol()) IS NOT NULL));

-- onboarding_checklist: leidinggevenden lezen, alleen HR schrijft. De oude regel
-- admin_read_checklist had geen rolcontrole (iedereen in de organisatie las mee).
DROP POLICY IF EXISTS teamleider_eigen_checklist ON public.onboarding_checklist;
DROP POLICY IF EXISTS admin_read_checklist ON public.onboarding_checklist;
CREATE POLICY admin_read_checklist ON public.onboarding_checklist FOR SELECT
  USING (get_my_role() = 'admin' AND tenant_id = get_my_tenant_id());
CREATE POLICY leidinggevende_lees_checklist ON public.onboarding_checklist FOR SELECT
  USING ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND tenant_id = get_my_tenant_id());
CREATE POLICY hr_schrijf_checklist ON public.onboarding_checklist FOR INSERT
  WITH CHECK ((SELECT public.mijn_leidinggevende_rol()) = 'hr' AND tenant_id = get_my_tenant_id());
CREATE POLICY hr_wijzig_checklist ON public.onboarding_checklist FOR UPDATE
  USING ((SELECT public.mijn_leidinggevende_rol()) = 'hr' AND tenant_id = get_my_tenant_id())
  WITH CHECK ((SELECT public.mijn_leidinggevende_rol()) = 'hr' AND tenant_id = get_my_tenant_id());
CREATE POLICY hr_verwijder_checklist ON public.onboarding_checklist FOR DELETE
  USING ((SELECT public.mijn_leidinggevende_rol()) = 'hr' AND tenant_id = get_my_tenant_id());

-- document_aanvragen_beheer
DROP POLICY IF EXISTS teamleider_eigen_aanvragen ON public.document_aanvragen_beheer;
CREATE POLICY teamleider_eigen_aanvragen ON public.document_aanvragen_beheer FOR SELECT
  USING ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND ingediend_door = get_my_profile_id());
DROP POLICY IF EXISTS teamleider_insert_aanvraag ON public.document_aanvragen_beheer;
CREATE POLICY teamleider_insert_aanvraag ON public.document_aanvragen_beheer FOR INSERT
  WITH CHECK ((SELECT public.mijn_leidinggevende_rol()) IS NOT NULL AND tenant_id = get_my_tenant_id());

-- aanvragen
DROP POLICY IF EXISTS teamleider_insert_aanvragen ON public.aanvragen;
CREATE POLICY teamleider_insert_aanvragen ON public.aanvragen FOR INSERT
  WITH CHECK ((get_my_role() = 'admin' OR (SELECT public.mijn_leidinggevende_rol()) IS NOT NULL)
              AND tenant_id = get_my_tenant_id());
