-- Rechtentest D3 (migratie 109): veilig verwijderen.
-- Draaien NA migratie 109, of samen ermee in één verzoek. Alles in één transactie, aan het
-- eind teruggedraaid (RAISE).
-- Rollen: beheerder (eigen organisatie, geen superadmin), beheerder andere organisatie, HR,
-- teamleider, medewerker, anon; "server" = de rol die de Edge Function gebruikt (hier postgres).
-- Controleert:
--  A. verwijder_account en wis_losgekoppelde_gesprekken zijn niet aan te roepen door
--     authenticated of anon (alleen de server);
--  B. via de server: alleen een beheerder van de eigen organisatie, niet zichzelf, niet een
--     andere organisatie, niet als HR/teamleider/medewerker;
--  C. uit_dienst: gesprekken blijven met user_id leeg, losgekoppeld_op gezet, tekst intact;
--     app_feedback / document_aanvragen_beheer / onboarding_checklist blokkeren niet;
--     auditregel met e-mailadres;
--  D. avg: vraag en antwoord '[verwijderd]', duimpje en zoekmethode blijven, push weg,
--     auditregel zonder e-mailadres;
--  E. leidinggevende: zonder keuze niets verwijderd; chattoegang_uit = alleen_dashboard aan,
--     account blijft; ook_leidinggevende = rij en account weg;
--  F. losgekoppelde gesprekken: medewerker ziet ze niet, beheerder wel; INSERT met user_id
--     leeg geweigerd;
--  G. auth-account direct verwijderen (cascade) koppelt ook los, met tijdstip;
--  H. nachtelijke taak: na 12 maanden tekst gewist, eerder niet.
DO $$
DECLARE
  v_t uuid; v_ander_t uuid;
  v_adm uuid := gen_random_uuid(); v_vadm uuid := gen_random_uuid();
  v_hr uuid := gen_random_uuid(); v_tl uuid := gen_random_uuid();
  v_mw1 uuid := gen_random_uuid(); v_mw2 uuid := gen_random_uuid(); v_mw3 uuid := gen_random_uuid();
  v_lg1 uuid := gen_random_uuid(); v_lg2 uuid := gen_random_uuid(); v_lg3 uuid := gen_random_uuid();
  v_p record; v_res jsonb; v_n int; v_m int; v_tekst text; v_fb text; v_zm text; v_los timestamptz;
  v_fouten text := ''; v_matrix text := '';
  r record;
  v_profiel_mw1 uuid; v_profiel_mw2 uuid; v_profiel_mw3 uuid; v_fb_id uuid;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;

  FOR r IN SELECT * FROM (VALUES
      (v_adm, 'admin', v_t), (v_vadm, 'admin', v_ander_t), (v_hr, 'teamleider', v_t), (v_tl, 'teamleider', v_t),
      (v_mw1, 'medewerker', v_t), (v_mw2, 'medewerker', v_t), (v_mw3, 'medewerker', v_t),
      (v_lg1, 'teamleider', v_t), (v_lg2, 'teamleider', v_t), (v_lg3, 'teamleider', v_t)
    ) AS x(u, rol, tenant) LOOP
    INSERT INTO public.uitnodigingen (tenant_id, email, naam, role)
    VALUES (r.tenant, 'rechtentest-vv-' || r.u || '@example.invalid', 'Rechtentest ' || r.rol, r.rol);
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (r.u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'rechtentest-vv-' || r.u || '@example.invalid', now(), now());
  END LOOP;
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES
    (v_t, 'RT hr', 'rechtentest-vv-' || v_hr || '@example.invalid', 'hr'),
    (v_t, 'RT tl', 'rechtentest-vv-' || v_tl || '@example.invalid', 'teamleider'),
    (v_t, 'RT lg1', 'rechtentest-vv-' || v_lg1 || '@example.invalid', 'hr'),
    (v_t, 'RT lg2', 'rechtentest-vv-' || v_lg2 || '@example.invalid', 'hr'),
    (v_t, 'RT lg3', 'rechtentest-vv-' || v_lg3 || '@example.invalid', 'teamleider');
  SELECT id INTO v_profiel_mw1 FROM public.profiles WHERE user_id = v_mw1;
  SELECT id INTO v_profiel_mw2 FROM public.profiles WHERE user_id = v_mw2;
  SELECT id INTO v_profiel_mw3 FROM public.profiles WHERE user_id = v_mw3;
  INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord, feedback, zoek_methode, herkomst)
  SELECT v_t, p, 'Rechtentest vraag van ' || p, 'antwoord', 'goed', 'vector', '{"x":1}'::jsonb
    FROM unnest(ARRAY[v_profiel_mw1, v_profiel_mw1, v_profiel_mw2, v_profiel_mw3]) p;
  INSERT INTO public.app_feedback (tenant_id, medewerker_id, status) VALUES (v_t, v_profiel_mw1, 'nieuw') RETURNING id INTO v_fb_id;
  INSERT INTO public.document_aanvragen_beheer (tenant_id, ingediend_door, bestandsnaam, bestandspad, toelichting)
    VALUES (v_t, v_profiel_mw1, 'rt.pdf', 'rt/rt.pdf', 'rechtentest');
  INSERT INTO public.onboarding_checklist (tenant_id, stap_naam, afgerond_door) VALUES (v_t, 'rechtentest', v_profiel_mw1);
  INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth) VALUES (v_mw2, v_t, 'https://example.invalid/rt', 'x', 'y');

  -- A. niet aan te roepen door authenticated/anon
  FOR r IN SELECT * FROM (VALUES ('beheerder', v_adm), ('medewerker', v_mw1)) AS x(naam, u) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.verwijder_account(r.u, v_profiel_mw3, 'uit_dienst', NULL);
      v_fouten := v_fouten || format(' [A %s kon verwijder_account aanroepen]', r.naam);
    EXCEPTION WHEN insufficient_privilege THEN v_matrix := v_matrix || format(' A:%s geweigerd', r.naam);
    END;
    BEGIN
      PERFORM public.wis_losgekoppelde_gesprekken();
      v_fouten := v_fouten || format(' [A %s kon wissen]', r.naam);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.verwijder_account(v_adm, v_profiel_mw3, 'uit_dienst', NULL);
    v_fouten := v_fouten || ' [A anon kon verwijder_account aanroepen]';
  EXCEPTION WHEN insufficient_privilege THEN v_matrix := v_matrix || ' A:anon geweigerd';
  END;
  RESET ROLE;

  -- B. beslisregel via de server
  FOR r IN SELECT * FROM (VALUES ('hr', v_hr), ('teamleider', v_tl), ('medewerker', v_mw2), ('beheerder_andere_org', v_vadm)) AS x(naam, u) LOOP
    v_res := public.verwijder_account(r.u, v_profiel_mw3, 'uit_dienst', NULL);
    v_matrix := v_matrix || format(' B:%s %s', r.naam, CASE WHEN v_res ? 'fout' THEN 'geweigerd' ELSE 'VERWIJDERD' END);
    IF NOT v_res ? 'fout' THEN v_fouten := v_fouten || format(' [B %s kon verwijderen]', r.naam); END IF;
  END LOOP;
  SELECT id INTO v_p FROM public.profiles WHERE user_id = v_adm;
  v_res := public.verwijder_account(v_adm, v_p.id, 'uit_dienst', NULL);
  IF NOT v_res ? 'fout' THEN v_fouten := v_fouten || ' [B eigen account verwijderd]'; END IF;
  v_res := public.verwijder_account(v_adm, v_profiel_mw3, 'iets', NULL);
  IF NOT v_res ? 'fout' THEN v_fouten := v_fouten || ' [B onbekende modus geaccepteerd]'; END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_profiel_mw3;
  IF v_n <> 1 THEN v_fouten := v_fouten || ' [B mw3 toch weg]'; END IF;

  -- C. uit dienst
  v_res := public.verwijder_account(v_adm, v_profiel_mw1, 'uit_dienst', NULL);
  SELECT count(*), min(vraag) INTO v_n, v_tekst FROM public.conversations WHERE vraag = 'Rechtentest vraag van ' || v_profiel_mw1;
  v_matrix := v_matrix || format(' C:%s gesprekken=%s tekst=%s', v_res->>'actie', v_n, CASE WHEN v_tekst LIKE 'Rechtentest%' THEN 'intact' ELSE COALESCE(v_tekst, '-') END);
  SELECT count(*) INTO v_m FROM public.conversations WHERE vraag = 'Rechtentest vraag van ' || v_profiel_mw1 AND user_id IS NULL AND losgekoppeld_op IS NOT NULL;
  IF v_res->>'actie' IS DISTINCT FROM 'verwijderd' OR v_n <> 2 OR v_m <> 2 THEN v_fouten := v_fouten || format(' [C uit_dienst: %s, %s rijen, %s losgekoppeld]', v_res, v_n, v_m); END IF;
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_profiel_mw1;
  IF v_n <> 0 THEN v_fouten := v_fouten || ' [C profiel bestaat nog]'; END IF;
  SELECT (SELECT count(*) FROM public.app_feedback WHERE id = v_fb_id AND medewerker_id IS NULL)
       + (SELECT count(*) FROM public.document_aanvragen_beheer WHERE bestandspad = 'rt/rt.pdf' AND ingediend_door IS NULL)
       + (SELECT count(*) FROM public.onboarding_checklist WHERE stap_naam = 'rechtentest' AND afgerond_door IS NULL) INTO v_n;
  IF v_n < 3 THEN v_fouten := v_fouten || format(' [C verwijzingen niet leeg: %s/3]', v_n); END IF;
  SELECT count(*) INTO v_n FROM public.audit_log WHERE actie = 'MEDEWERKER_VERWIJDERD' AND object_id::text = v_profiel_mw1::text AND details ? 'email' AND details->>'modus' = 'uit_dienst';
  IF v_n <> 1 THEN v_fouten := v_fouten || ' [C geen auditregel]'; END IF;

  -- D. AVG
  v_res := public.verwijder_account(v_adm, v_profiel_mw2, 'avg', NULL);
  SELECT vraag, feedback, zoek_methode INTO v_tekst, v_fb, v_zm FROM public.conversations
   WHERE tenant_id = v_t AND vraag = '[verwijderd]' AND zoek_methode = 'vector' AND feedback = 'goed' AND herkomst IS NULL AND user_id IS NULL
   ORDER BY created_at DESC LIMIT 1;
  SELECT count(*) INTO v_n FROM public.conversations WHERE vraag = 'Rechtentest vraag van ' || v_profiel_mw2;
  SELECT count(*) INTO v_m FROM public.push_subscriptions WHERE user_id = v_mw2;
  v_matrix := v_matrix || format(' D:%s tekst=%s duim=%s zoek=%s oude_tekst=%s push=%s', v_res->>'actie', v_tekst, v_fb, v_zm, v_n, v_m);
  IF v_tekst IS DISTINCT FROM '[verwijderd]' OR v_fb IS DISTINCT FROM 'goed' OR v_zm IS DISTINCT FROM 'vector' OR v_n <> 0 OR v_m <> 0 THEN
    v_fouten := v_fouten || ' [D avg klopt niet]';
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_log WHERE actie = 'ACCOUNT_VERWIJDERD_AVG' AND object_id::text = v_profiel_mw2::text AND NOT details ? 'email' AND NOT details ? 'naam';
  IF v_n <> 1 THEN v_fouten := v_fouten || ' [D auditregel ontbreekt of bevat e-mail]'; END IF;

  -- E. leidinggevende
  SELECT id INTO v_p FROM public.profiles WHERE user_id = v_lg1;
  v_res := public.verwijder_account(v_adm, v_p.id, 'uit_dienst', NULL);
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_p.id;
  v_matrix := v_matrix || format(' E:zonder keuze %s', CASE WHEN (v_res->>'keuze_nodig')::boolean AND v_n = 1 THEN 'vraagt keuze' ELSE 'FOUT' END);
  IF NOT COALESCE((v_res->>'keuze_nodig')::boolean, false) OR v_n <> 1 OR v_res->>'leidinggevende_rol' <> 'hr' THEN v_fouten := v_fouten || ' [E zonder keuze]'; END IF;
  v_res := public.verwijder_account(v_adm, v_p.id, 'uit_dienst', 'chattoegang_uit');
  SELECT count(*) FILTER (WHERE alleen_dashboard) INTO v_n FROM public.profiles WHERE id = v_p.id;
  SELECT count(*) INTO v_m FROM public.teamleiders WHERE lower(email) = 'rechtentest-vv-' || v_lg1 || '@example.invalid';
  v_matrix := v_matrix || format(' E:chattoegang_uit %s/%s', v_n, v_m);
  IF v_res->>'actie' IS DISTINCT FROM 'chattoegang_uit' OR v_n <> 1 OR v_m <> 1 THEN v_fouten := v_fouten || ' [E chattoegang_uit]'; END IF;
  SELECT id INTO v_p FROM public.profiles WHERE user_id = v_lg2;
  v_res := public.verwijder_account(v_adm, v_p.id, 'uit_dienst', 'ook_leidinggevende');
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_p.id;
  SELECT count(*) INTO v_m FROM public.teamleiders WHERE lower(email) = 'rechtentest-vv-' || v_lg2 || '@example.invalid';
  v_matrix := v_matrix || format(' E:ook_leidinggevende %s/%s', v_n, v_m);
  IF v_res->>'actie' IS DISTINCT FROM 'verwijderd' OR v_n <> 0 OR v_m <> 0 THEN v_fouten := v_fouten || ' [E ook_leidinggevende]'; END IF;

  -- F. zichtbaarheid van losgekoppelde gesprekken
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mw3, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.conversations WHERE user_id IS NULL;
  BEGIN
    INSERT INTO public.conversations (tenant_id, user_id, vraag) VALUES (v_t, NULL, 'rt zonder persoon');
    v_m := 1;
  EXCEPTION WHEN insufficient_privilege THEN v_m := 0;
  END;
  RESET ROLE;
  v_matrix := v_matrix || format(' F:medewerker ziet %s, insert leeg %s', v_n, CASE WHEN v_m = 0 THEN 'geweigerd' ELSE 'TOEGESTAAN' END);
  IF v_n <> 0 OR v_m <> 0 THEN v_fouten := v_fouten || ' [F medewerker ziet of schrijft losgekoppelde gesprekken]'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.conversations WHERE user_id IS NULL AND vraag IN ('Rechtentest vraag van ' || v_profiel_mw1, '[verwijderd]');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_vadm, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_m FROM public.conversations WHERE user_id IS NULL AND tenant_id = v_t;
  RESET ROLE;
  v_matrix := v_matrix || format(' F:beheerder ziet %s, andere org %s', v_n, v_m);
  IF v_n < 3 OR v_m <> 0 THEN v_fouten := v_fouten || ' [F beheerder ziet ze niet of andere org wel]'; END IF;

  -- G. cascade vanuit auth.users
  INSERT INTO public.conversations (tenant_id, user_id, vraag) VALUES (v_t, v_profiel_mw3, 'Rechtentest cascade');
  DELETE FROM auth.users WHERE id = v_mw3;
  SELECT count(*), max(losgekoppeld_op) INTO v_n, v_los FROM public.conversations WHERE vraag = 'Rechtentest cascade' AND user_id IS NULL;
  v_matrix := v_matrix || format(' G:cascade %s/%s', v_n, CASE WHEN v_los IS NULL THEN 'geen tijd' ELSE 'tijd gezet' END);
  IF v_n <> 1 OR v_los IS NULL THEN v_fouten := v_fouten || ' [G cascade koppelt niet los]'; END IF;

  -- H. nachtelijke taak
  UPDATE public.conversations SET losgekoppeld_op = now() - interval '13 months' WHERE vraag = 'Rechtentest cascade';
  UPDATE public.conversations SET losgekoppeld_op = now() - interval '11 months' WHERE vraag = 'Rechtentest vraag van ' || v_profiel_mw1;
  PERFORM public.wis_losgekoppelde_gesprekken();
  SELECT count(*) INTO v_n FROM public.conversations WHERE vraag = 'Rechtentest cascade';
  SELECT count(*) INTO v_m FROM public.conversations WHERE vraag = 'Rechtentest vraag van ' || v_profiel_mw1;
  v_matrix := v_matrix || format(' H:13mnd over=%s 11mnd over=%s', v_n, v_m);
  IF v_n <> 0 OR v_m <> 2 THEN v_fouten := v_fouten || ' [H nachtelijke taak]'; END IF;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX:%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: verwijderen alleen via de server door de beheerder van de eigen organisatie; loskoppelen, AVG, leidinggevende en nachtelijke taak kloppen (alles teruggedraaid) || MATRIX:%', v_matrix;
END $$;
