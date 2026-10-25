-- Rechtentest en rekentest F (migratie 110): facturatie.
-- Draaien NA migratie 110, of samen ermee in één verzoek. Alles in één transactie, aan het
-- eind teruggedraaid (RAISE).
-- A. Rechten: superadmin leest historie, maanden en overzicht; beheerder alleen het tarief van
--    de eigen organisatie; HR, teamleider, medewerker, beheerder andere organisatie en anon
--    niets; niemand schrijft in account_historie of facturatie_maand; de interne functies
--    (bereken_, zet_..._vast, log_) zijn niet aan te roepen.
-- B. Logboek: nieuw profiel = open periode; rolwissel = nieuwe periode; auth-account
--    verwijderen = gestopt_op gezet, rijen blijven; terugvulling dekt alle profielen.
-- C. Telling september 2026 (Nederlandse tijd) in een testorganisatie, minimum 15, tarieven.
-- D. Vastzetten: tweede keer voegt niets toe.
DO $$
DECLARE
  v_t uuid; v_ander_t uuid; v_test_t uuid;
  v_sa uuid;
  v_adm uuid := gen_random_uuid(); v_vadm uuid := gen_random_uuid(); v_hr uuid := gen_random_uuid();
  v_tl uuid := gen_random_uuid(); v_mw uuid := gen_random_uuid(); v_nieuw uuid := gen_random_uuid();
  v_n int; v_m int; v_k int; v_upd int; v_fouten text := ''; v_matrix text := '';
  v_rij record; r record; v_acc uuid;
BEGIN
  SELECT p.tenant_id, s.user_id INTO v_t, v_sa FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;
  INSERT INTO public.tenants (naam) VALUES ('Rechtentest facturatie') RETURNING id INTO v_test_t;

  FOR r IN SELECT * FROM (VALUES
      (v_adm, 'admin', v_t), (v_vadm, 'admin', v_ander_t), (v_hr, 'teamleider', v_t), (v_tl, 'teamleider', v_t),
      (v_mw, 'medewerker', v_t)) AS x(u, rol, tenant) LOOP
    INSERT INTO public.uitnodigingen (tenant_id, email, naam, role)
    VALUES (r.tenant, 'rechtentest-fa-' || r.u || '@example.invalid', 'RT', r.rol);
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (r.u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rechtentest-fa-' || r.u || '@example.invalid', now(), now());
  END LOOP;
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES
    (v_t, 'RT hr', 'rechtentest-fa-' || v_hr || '@example.invalid', 'hr'),
    (v_t, 'RT tl', 'rechtentest-fa-' || v_tl || '@example.invalid', 'teamleider');
  INSERT INTO public.facturatie_tarief (tenant_id, contract, prijs_cent, geldig_vanaf) VALUES (v_t, 'maand', 1950, '2026-01-01');

  -- A. Rechten
  FOR r IN SELECT * FROM (VALUES ('superadmin', v_sa), ('beheerder', v_adm), ('hr', v_hr), ('teamleider', v_tl),
                                 ('medewerker', v_mw), ('beheerder_andere_org', v_vadm)) AS x(naam, u) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.account_historie;
    SELECT count(*) INTO v_m FROM public.facturatie_tarief WHERE tenant_id = v_t;
    BEGIN
      SELECT count(*) INTO v_k FROM public.facturatie_maandoverzicht('2026-09-01');
    EXCEPTION WHEN insufficient_privilege THEN v_k := -1;
    END;
    -- schrijven in de historie
    BEGIN
      INSERT INTO public.account_historie (tenant_id, account_id, rol, aangemaakt_op) VALUES (v_t, gen_random_uuid(), 'medewerker', now());
      v_fouten := v_fouten || format(' [A %s schrijft historie]', r.naam);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      UPDATE public.account_historie SET gestopt_op = now() WHERE tenant_id = v_t;
      GET DIAGNOSTICS v_upd = ROW_COUNT;
      IF v_upd > 0 THEN v_fouten := v_fouten || format(' [A %s wijzigt historie]', r.naam); END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM public.zet_facturatie_maand_vast();
      v_fouten := v_fouten || format(' [A %s kan vastzetten]', r.naam);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      PERFORM * FROM public.bereken_facturatie_maand('2026-09-01');
      v_fouten := v_fouten || format(' [A %s kan bereken_ aanroepen]', r.naam);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RESET ROLE;
    v_matrix := v_matrix || format(' A:%s historie=%s tarief=%s overzicht=%s', r.naam,
      CASE WHEN v_n > 0 THEN 'leest' ELSE '0' END, v_m, CASE WHEN v_k = -1 THEN 'geweigerd' ELSE v_k::text END);
    IF r.naam = 'superadmin' THEN
      IF v_n = 0 OR v_m <> 1 OR v_k <= 0 THEN v_fouten := v_fouten || ' [A superadmin leest niet]'; END IF;
    ELSIF r.naam = 'beheerder' THEN
      IF v_n <> 0 OR v_m <> 1 OR v_k <> -1 THEN v_fouten := v_fouten || ' [A beheerder]'; END IF;
    ELSE
      IF v_n <> 0 OR v_m <> 0 OR v_k <> -1 THEN v_fouten := v_fouten || format(' [A %s ziet iets]', r.naam); END IF;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.account_historie WHERE tenant_id = v_t AND gestopt_op IS NOT NULL AND account_id IN (SELECT id FROM public.profiles WHERE user_id IN (v_adm, v_mw));
  IF v_n <> 0 THEN v_fouten := v_fouten || ' [A update op historie gelukt]'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    SELECT count(*) INTO v_n FROM public.account_historie;
    v_fouten := v_fouten || ' [A anon kan historie lezen]';
  EXCEPTION WHEN insufficient_privilege THEN v_matrix := v_matrix || ' A:anon geweigerd';
  END;
  RESET ROLE;

  -- B. Logboek via profiles
  SELECT count(*) INTO v_n FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM public.account_historie h WHERE h.account_id = p.id);
  IF v_n <> 0 THEN v_fouten := v_fouten || format(' [B %s profielen zonder historie]', v_n); END IF;
  INSERT INTO public.uitnodigingen (tenant_id, email, naam, role) VALUES (v_test_t, 'rechtentest-fa-n-' || v_nieuw || '@example.invalid', 'RT', 'medewerker');
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES (v_nieuw, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rechtentest-fa-n-' || v_nieuw || '@example.invalid', now(), now());
  SELECT id INTO v_acc FROM public.profiles WHERE user_id = v_nieuw;
  SELECT count(*) INTO v_n FROM public.account_historie WHERE account_id = v_acc AND gestopt_op IS NULL;
  UPDATE public.profiles SET account_type = 'tijdelijk' WHERE id = v_acc;
  UPDATE public.profiles SET einddatum = '2027-01-31' WHERE id = v_acc;
  SELECT count(*), count(*) FILTER (WHERE gestopt_op IS NULL AND einddatum = '2027-01-31') INTO v_m, v_k FROM public.account_historie WHERE account_id = v_acc;
  v_matrix := v_matrix || format(' B:nieuw=%s na_wissel=%s/%s', v_n, v_m, v_k);
  IF v_n <> 1 OR v_m <> 2 OR v_k <> 1 THEN v_fouten := v_fouten || ' [B periodes kloppen niet]'; END IF;
  DELETE FROM auth.users WHERE id = v_nieuw;
  SELECT count(*), count(*) FILTER (WHERE gestopt_op IS NULL) INTO v_n, v_m FROM public.account_historie WHERE account_id = v_acc;
  v_matrix := v_matrix || format(' B:na_verwijderen rijen=%s open=%s', v_n, v_m);
  IF v_n <> 2 OR v_m <> 0 THEN v_fouten := v_fouten || ' [B verwijderen]'; END IF;
  DELETE FROM public.account_historie WHERE tenant_id = v_test_t;

  -- C. Telling september 2026 in de testorganisatie (NL-tijd: 1 sep 00:00 = 31 aug 22:00 UTC)
  INSERT INTO public.account_historie (tenant_id, account_id, rol, alleen_dashboard, einddatum, aangemaakt_op, gestopt_op) VALUES
    (v_test_t, gen_random_uuid(), 'medewerker', false, NULL, '2026-08-15 10:00+00', NULL),            -- a telt
    (v_test_t, gen_random_uuid(), 'medewerker', false, NULL, '2026-09-30 21:59+00', NULL),            -- b telt (23:59 NL)
    (v_test_t, gen_random_uuid(), 'medewerker', false, NULL, '2026-09-30 22:30+00', NULL),            -- c niet (1 okt 00:30 NL)
    (v_test_t, gen_random_uuid(), 'medewerker', false, NULL, '2026-08-01 10:00+00', '2026-08-31 22:01+00'), -- d telt (1 sep 00:01 NL)
    (v_test_t, gen_random_uuid(), 'medewerker', false, NULL, '2026-08-01 10:00+00', '2026-08-31 21:59+00'), -- e niet (31 aug 23:59 NL)
    (v_test_t, gen_random_uuid(), 'medewerker', false, '2026-08-31', '2026-08-01 10:00+00', NULL),    -- f niet (einddatum vóór sep)
    (v_test_t, gen_random_uuid(), 'medewerker', false, '2026-09-01', '2026-08-01 10:00+00', NULL),    -- g telt
    (v_test_t, gen_random_uuid(), 'admin', false, NULL, '2026-08-01 10:00+00', NULL),                 -- h niet (beheerder)
    (v_test_t, gen_random_uuid(), 'teamleider', true, NULL, '2026-08-01 10:00+00', NULL),             -- i niet (alleen dashboard)
    (v_test_t, gen_random_uuid(), 'teamleider', false, NULL, '2026-08-01 10:00+00', NULL);            -- j telt
  v_acc := gen_random_uuid();                                                                          -- k: twee periodes, telt 1x
  INSERT INTO public.account_historie (tenant_id, account_id, rol, aangemaakt_op, gestopt_op) VALUES
    (v_test_t, v_acc, 'medewerker', '2026-08-01 10:00+00', '2026-09-10 10:00+00'),
    (v_test_t, v_acc, 'teamleider', '2026-09-10 10:00+00', NULL);
  SELECT * INTO v_rij FROM public.bereken_facturatie_maand('2026-09-17') b WHERE b.tenant_id = v_test_t;
  v_matrix := v_matrix || format(' C:aantal=%s te_factureren=%s bedrag=%s (%s, ingesteld=%s)', v_rij.aantal_actief, v_rij.te_factureren, v_rij.bedrag_cent, v_rij.contract, v_rij.tarief_ingesteld);
  IF v_rij.aantal_actief <> 6 OR v_rij.te_factureren <> 15 OR v_rij.bedrag_cent <> 29250 OR v_rij.tarief_ingesteld THEN
    v_fouten := v_fouten || ' [C telling of minimum]';
  END IF;
  -- Jaarcontract en meer dan 15 accounts.
  INSERT INTO public.facturatie_tarief (tenant_id, contract, prijs_cent, geldig_vanaf) VALUES (v_test_t, 'jaar', 1750, '2026-09-01');
  INSERT INTO public.account_historie (tenant_id, account_id, rol, aangemaakt_op)
    SELECT v_test_t, gen_random_uuid(), 'medewerker', '2026-08-01 10:00+00' FROM generate_series(1, 14);
  SELECT * INTO v_rij FROM public.bereken_facturatie_maand('2026-09-01') b WHERE b.tenant_id = v_test_t;
  v_matrix := v_matrix || format(' C:jaar aantal=%s bedrag=%s', v_rij.aantal_actief, v_rij.bedrag_cent);
  IF v_rij.aantal_actief <> 20 OR v_rij.te_factureren <> 20 OR v_rij.bedrag_cent <> 35000 OR v_rij.contract <> 'jaar' THEN
    v_fouten := v_fouten || ' [C jaarcontract]';
  END IF;
  -- Tarief dat pas later ingaat, telt niet voor augustus.
  SELECT * INTO v_rij FROM public.bereken_facturatie_maand('2026-08-01') b WHERE b.tenant_id = v_test_t;
  IF v_rij.contract <> 'maand' OR v_rij.prijs_cent <> 1950 THEN v_fouten := v_fouten || ' [C tarief geldig_vanaf]'; END IF;

  -- D. Vastzetten
  v_n := public.zet_facturatie_maand_vast();
  v_m := public.zet_facturatie_maand_vast();
  v_matrix := v_matrix || format(' D:vastgezet=%s tweede_keer=%s', v_n, v_m);
  IF v_n < 1 OR v_m <> 0 THEN v_fouten := v_fouten || ' [D vastzetten]'; END IF;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX:%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: facturatie alleen voor de superadmin (tarief ook voor de eigen beheerder); logboek, telling, minimum, tarieven en vastzetten kloppen (alles teruggedraaid) || MATRIX:%', v_matrix;
END $$;
