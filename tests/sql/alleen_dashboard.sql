-- Rechtentest D2 (migratie 108): accounts met alleen het dashboard.
-- Draaien NA migratie 108, of samen ermee in één verzoek (BEGIN; migratie; dit bestand; ROLLBACK).
-- Alles in één transactie, aan het eind teruggedraaid (RAISE).
-- Rollen: beheerder (eigen organisatie, geen superadmin), beheerder andere organisatie,
-- HR, teamleider, medewerker, anon, en het account met alleen het dashboard zelf.
-- Controleert:
--  1. uitnodiging met alleen_dashboard -> profiel met alleen_dashboard (handle_new_user);
--     met role 'medewerker' weigert de database alleen_dashboard (CHECK).
--  2. het account zelf kan alleen_dashboard niet uitzetten;
--  3. HR, teamleider, medewerker en anon kunnen het niet wijzigen bij een ander;
--  4. de beheerder van de eigen organisatie wel (aan en uit), maar niet bij een medewerker
--     (CHECK); een beheerder van een andere organisatie niet;
--  5. het dashboard blijft werken (mijn_leidinggevende_rol() = 'hr');
--  6. rij in teamleiders verwijderen -> role 'medewerker', alleen_dashboard false, auditregel.
DO $$
DECLARE
  v_t uuid; v_ander_t uuid;
  v_dash_u uuid := gen_random_uuid();   -- HR met alleen dashboard
  v_hr_u uuid := gen_random_uuid();     -- HR met chat
  v_tl_u uuid := gen_random_uuid();     -- teamleider met chat
  v_mw_u uuid := gen_random_uuid();     -- medewerker
  v_adm_u uuid := gen_random_uuid();    -- beheerder eigen organisatie
  v_vadm_u uuid := gen_random_uuid();   -- beheerder andere organisatie
  v_dash_email text; v_tl_rij uuid;
  v_waarde boolean; v_rol text; v_n int; v_dashrol text;
  v_fouten text := ''; v_matrix text := '';
  r record;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;
  v_dash_email := 'rechtentest-dash-' || v_dash_u || '@example.invalid';

  -- Accounts aanmaken zoals een uitnodiging dat doet (handle_new_user).
  FOR r IN SELECT * FROM (VALUES
      (v_dash_u, v_dash_email, 'teamleider', true, v_t),
      (v_hr_u, 'rechtentest-hr-' || v_hr_u || '@example.invalid', 'teamleider', false, v_t),
      (v_tl_u, 'rechtentest-tl-' || v_tl_u || '@example.invalid', 'teamleider', false, v_t),
      (v_mw_u, 'rechtentest-mw-' || v_mw_u || '@example.invalid', 'medewerker', false, v_t),
      (v_adm_u, 'rechtentest-adm-' || v_adm_u || '@example.invalid', 'admin', false, v_t),
      (v_vadm_u, 'rechtentest-vadm-' || v_vadm_u || '@example.invalid', 'admin', false, v_ander_t)
    ) AS x(u, email, rol, dash, tenant) LOOP
    INSERT INTO public.uitnodigingen (tenant_id, email, naam, role, alleen_dashboard)
    VALUES (r.tenant, r.email, 'Rechtentest', r.rol, r.dash);
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (r.u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', r.email, now(), now());
  END LOOP;
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES (v_t, 'Rechtentest dash', v_dash_email, 'hr') RETURNING id INTO v_tl_rij;
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol)
    SELECT v_t, 'Rechtentest hr', email, 'hr' FROM public.profiles WHERE user_id = v_hr_u;
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol, teams)
    SELECT v_t, 'Rechtentest tl', email, 'teamleider', ARRAY['Rechtentest team'] FROM public.profiles WHERE user_id = v_tl_u;

  -- 1. handle_new_user
  SELECT alleen_dashboard, role INTO v_waarde, v_rol FROM public.profiles WHERE user_id = v_dash_u;
  v_matrix := v_matrix || format(' 1:profiel %s/%s', v_rol, v_waarde);
  IF v_waarde IS DISTINCT FROM true OR v_rol <> 'teamleider' THEN v_fouten := v_fouten || ' [1 profiel zonder alleen_dashboard]'; END IF;
  SELECT alleen_dashboard INTO v_waarde FROM public.profiles WHERE user_id = v_hr_u;
  IF v_waarde IS DISTINCT FROM false THEN v_fouten := v_fouten || ' [1 standaard niet false]'; END IF;
  BEGIN
    INSERT INTO public.uitnodigingen (tenant_id, email, naam, role, alleen_dashboard)
    VALUES (v_t, 'rechtentest-fout-' || gen_random_uuid() || '@example.invalid', 'x', 'medewerker', true);
    v_fouten := v_fouten || ' [1 uitnodiging medewerker+alleen_dashboard toegestaan]';
  EXCEPTION WHEN check_violation THEN v_matrix := v_matrix || ' 1:check-uitnodiging ok';
  END;

  -- 2. het account zelf
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dash_u, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_dashrol := public.mijn_leidinggevende_rol();
  BEGIN
    UPDATE public.profiles SET alleen_dashboard = false WHERE user_id = v_dash_u;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_fouten := v_fouten || ' [2 zelf uitgezet]'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN v_matrix := v_matrix || ' 2:zelf geweigerd';
  END;
  RESET ROLE;
  -- 5. dashboard
  v_matrix := v_matrix || format(' 5:dashboard %s', COALESCE(v_dashrol, '-'));
  IF v_dashrol IS DISTINCT FROM 'hr' THEN v_fouten := v_fouten || ' [5 geen dashboard]'; END IF;

  -- 3. andere rollen en anon
  FOR r IN SELECT * FROM (VALUES ('hr', v_hr_u), ('teamleider', v_tl_u), ('medewerker', v_mw_u), ('beheerder_andere_org', v_vadm_u)) AS x(naam, u) LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', r.u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE public.profiles SET alleen_dashboard = false WHERE user_id = v_dash_u;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION WHEN insufficient_privilege THEN v_n := -1;
    END;
    RESET ROLE;
    v_matrix := v_matrix || format(' 3:%s %s', r.naam, CASE WHEN v_n = -1 THEN 'geweigerd' WHEN v_n = 0 THEN '0 rijen' ELSE 'GEWIJZIGD' END);
    IF v_n > 0 THEN v_fouten := v_fouten || format(' [3 %s kon wijzigen]', r.naam); END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN
    UPDATE public.profiles SET alleen_dashboard = false WHERE user_id = v_dash_u;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_n := -1;
  END;
  RESET ROLE;
  v_matrix := v_matrix || format(' 3:anon %s', CASE WHEN v_n = -1 THEN 'geweigerd' WHEN v_n = 0 THEN '0 rijen' ELSE 'GEWIJZIGD' END);
  IF v_n > 0 THEN v_fouten := v_fouten || ' [3 anon kon wijzigen]'; END IF;
  SELECT alleen_dashboard INTO v_waarde FROM public.profiles WHERE user_id = v_dash_u;
  IF v_waarde IS DISTINCT FROM true THEN v_fouten := v_fouten || ' [2/3 waarde toch veranderd]'; END IF;

  -- 4. beheerder eigen organisatie
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adm_u, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE public.profiles SET alleen_dashboard = false WHERE user_id = v_dash_u;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.profiles SET alleen_dashboard = true WHERE user_id = v_hr_u;
  BEGIN
    UPDATE public.profiles SET alleen_dashboard = true WHERE user_id = v_mw_u;
    v_fouten := v_fouten || ' [4 medewerker kreeg alleen_dashboard]';
  EXCEPTION WHEN check_violation THEN v_matrix := v_matrix || ' 4:check-medewerker ok';
  END;
  RESET ROLE;
  SELECT alleen_dashboard INTO v_waarde FROM public.profiles WHERE user_id = v_hr_u;
  v_matrix := v_matrix || format(' 4:beheerder uit=%s aan=%s', v_n, v_waarde);
  IF v_n <> 1 OR v_waarde IS DISTINCT FROM true THEN v_fouten := v_fouten || ' [4 beheerder kon niet wijzigen]'; END IF;
  UPDATE public.profiles SET alleen_dashboard = true WHERE user_id = v_dash_u;

  -- 6. rij in teamleiders verwijderen
  DELETE FROM public.teamleiders WHERE id = v_tl_rij;
  SELECT role, alleen_dashboard INTO v_rol, v_waarde FROM public.profiles WHERE user_id = v_dash_u;
  SELECT count(*) INTO v_n FROM public.audit_log a JOIN public.profiles p ON p.id::text = a.object_id::text
   WHERE p.user_id = v_dash_u AND a.actie = 'LEIDINGGEVENDE_ROL_INGETROKKEN' AND (a.details->>'alleen_dashboard_was')::boolean;
  v_matrix := v_matrix || format(' 6:na verwijderen %s/%s audit=%s', v_rol, v_waarde, v_n);
  IF v_rol <> 'medewerker' OR v_waarde IS DISTINCT FROM false OR v_n <> 1 THEN v_fouten := v_fouten || ' [6 intrekken klopt niet]'; END IF;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX:%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: alleen_dashboard alleen door de beheerder van de eigen organisatie te wijzigen; uitnodiging, dashboard en intrekken kloppen (alles teruggedraaid) || MATRIX:%', v_matrix;
END $$;
