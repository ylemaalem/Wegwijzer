-- Rechtentest audit-fixes deel 1 (B-04 gesprekken, B-07 documentaanvragen, B-08 rapporten).
-- Rollen: beheerder, hr, teamleider, medewerker, andere_admin (andere organisatie),
--         collega (tweede medewerker), anon (niet ingelogd), server (service_role).
-- Elke actie draait in een eigen blok dat wordt teruggedraaid. Het geheel eindigt
-- altijd met RAISE EXCEPTION: er blijft niets staan (geen COMMIT).
-- Uitvoer: per actie Y (lukt) of N (geweigerd / 0 rijen), en of dat de verwachting
-- NA de migraties 115-117 is. Vóór de migraties hoort hier "VERSCHIL" te staan bij
-- de gaten uit de audit.
DO $$
DECLARE
  v_t uuid; v_t2 uuid;
  v_namen text[] := ARRAY['beheerder','hr','teamleider','medewerker','andere_admin','collega'];
  v_users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_rollen text[] := ARRAY['admin','teamleider','teamleider','medewerker','admin','medewerker'];
  v_tlrol text[]  := ARRAY[NULL, 'hr', 'teamleider', NULL, NULL, NULL];
  v_prof uuid[] := ARRAY[]::uuid[];
  v_p uuid;
  c_m uuid; c_tl uuid; c_x uuid; d_m uuid; d_x uuid;
  -- actor | actie | soort (dml = telt gewijzigde rijen, cnt = telt zichtbare rijen) | verwacht na migratie | SQL
  v_tests text[] := ARRAY[
    -- B-04 gesprekken
    'medewerker|gesprek: eigen duimpje zetten|dml|Y|UPDATE public.conversations SET feedback = ''goed'', feedback_op = now() WHERE id = ''{CM}''',
    'medewerker|gesprek: eigen datum terugzetten|dml|N|UPDATE public.conversations SET created_at = now() - interval ''2 days'' WHERE id = ''{CM}''',
    'medewerker|gesprek: eigen vraag herschrijven|dml|N|UPDATE public.conversations SET vraag = ''anders'' WHERE id = ''{CM}''',
    'medewerker|gesprek: eigen antwoord herschrijven|dml|N|UPDATE public.conversations SET antwoord = ''anders'' WHERE id = ''{CM}''',
    'medewerker|gesprek: eigen gesprek naar andere organisatie|dml|N|UPDATE public.conversations SET tenant_id = ''{T2}'' WHERE id = ''{CM}''',
    'medewerker|gesprek: zelf invoegen (eigen organisatie)|dml|N|INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord) VALUES (''{T}'', ''{PSELF}'', ''x'', ''y'')',
    'medewerker|gesprek: zelf invoegen (andere organisatie)|dml|N|INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord) VALUES (''{T2}'', ''{PSELF}'', ''x'', ''y'')',
    'medewerker|gesprek: van collega wijzigen|dml|N|UPDATE public.conversations SET feedback = ''goed'' WHERE id = ''{CX}''',
    'medewerker|gesprek: van collega lezen|cnt|N|SELECT count(*) FROM public.conversations WHERE id = ''{CX}''',
    'medewerker|gesprek: eigen lezen|cnt|Y|SELECT count(*) FROM public.conversations WHERE id = ''{CM}''',
    'medewerker|gesprek: eigen verwijderen|dml|N|DELETE FROM public.conversations WHERE id = ''{CM}''',
    'teamleider|gesprek: eigen duimpje zetten|dml|Y|UPDATE public.conversations SET feedback = ''goed'', feedback_op = now() WHERE id = ''{CTL}''',
    'teamleider|gesprek: eigen datum terugzetten|dml|N|UPDATE public.conversations SET created_at = now() - interval ''2 days'' WHERE id = ''{CTL}''',
    'teamleider|gesprek: zelf invoegen (eigen organisatie)|dml|N|INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord) VALUES (''{T}'', ''{PSELF}'', ''x'', ''y'')',
    'teamleider|gesprek: van medewerker lezen|cnt|N|SELECT count(*) FROM public.conversations WHERE id = ''{CM}''',
    'hr|gesprek: van medewerker wijzigen|dml|N|UPDATE public.conversations SET feedback = ''goed'' WHERE id = ''{CM}''',
    'beheerder|gesprek: verbeterpunt afhandelen|dml|Y|UPDATE public.conversations SET feedback_afgehandeld_op = now() WHERE id = ''{CM}''',
    'beheerder|gesprek: naar andere organisatie|dml|N|UPDATE public.conversations SET tenant_id = ''{T2}'' WHERE id = ''{CM}''',
    'beheerder|gesprek: lezen|cnt|Y|SELECT count(*) FROM public.conversations WHERE id = ''{CM}''',
    'beheerder|gesprek: verwijderen|dml|Y|DELETE FROM public.conversations WHERE id = ''{CM}''',
    'andere_admin|gesprek: lezen|cnt|N|SELECT count(*) FROM public.conversations WHERE id = ''{CM}''',
    'andere_admin|gesprek: wijzigen|dml|N|UPDATE public.conversations SET feedback = ''goed'' WHERE id = ''{CM}''',
    'anon|gesprek: lezen|cnt|N|SELECT count(*) FROM public.conversations WHERE id = ''{CM}''',
    'anon|gesprek: wijzigen|dml|N|UPDATE public.conversations SET feedback = ''goed'' WHERE id = ''{CM}''',
    'anon|gesprek: invoegen|dml|N|INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord) VALUES (''{T}'', ''{PM}'', ''x'', ''y'')',
    'server|gesprek: invoegen|dml|Y|INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord) VALUES (''{T}'', ''{PM}'', ''x'', ''y'')',
    'server|gesprek: alle velden wijzigen|dml|Y|UPDATE public.conversations SET vraag = ''anders'', created_at = now() - interval ''1 day'', user_id = NULL WHERE id = ''{CM}''',
    'server|gesprek: verwijderen|dml|Y|DELETE FROM public.conversations WHERE id = ''{CM}''',
    -- B-07 documentaanvragen
    'medewerker|aanvraag: van collega lezen|cnt|N|SELECT count(*) FROM public.document_aanvragen WHERE id = ''{DX}''',
    'medewerker|aanvraag: van collega wijzigen|dml|N|UPDATE public.document_aanvragen SET vraag = ''anders'' WHERE id = ''{DX}''',
    'medewerker|aanvraag: van collega verwijderen|dml|N|DELETE FROM public.document_aanvragen WHERE id = ''{DX}''',
    'medewerker|aanvraag: eigen lezen|cnt|Y|SELECT count(*) FROM public.document_aanvragen WHERE id = ''{DM}''',
    'medewerker|aanvraag: indienen zoals de app (zonder organisatie)|dml|Y|INSERT INTO public.document_aanvragen (user_id, vraag, status) VALUES (''{USELF}'', ''x'', ''nieuw'')',
    'medewerker|aanvraag: indienen bij andere organisatie|dml|N|INSERT INTO public.document_aanvragen (user_id, vraag, status, tenant_id) VALUES (''{USELF}'', ''x'', ''nieuw'', ''{T2}'')',
    'medewerker|aanvraag: indienen op naam van collega|dml|N|INSERT INTO public.document_aanvragen (user_id, vraag, status, tenant_id) VALUES (''{UX}'', ''x'', ''nieuw'', ''{T}'')',
    'teamleider|aanvraag: van medewerker lezen|cnt|N|SELECT count(*) FROM public.document_aanvragen WHERE id = ''{DM}''',
    'hr|aanvraag: van medewerker lezen|cnt|N|SELECT count(*) FROM public.document_aanvragen WHERE id = ''{DM}''',
    'beheerder|aanvraag: lezen|cnt|Y|SELECT count(*) FROM public.document_aanvragen WHERE id = ''{DM}''',
    'beheerder|aanvraag: wijzigen|dml|Y|UPDATE public.document_aanvragen SET status = ''afgewezen'' WHERE id = ''{DM}''',
    'beheerder|aanvraag: verwijderen|dml|Y|DELETE FROM public.document_aanvragen WHERE id = ''{DM}''',
    'andere_admin|aanvraag: lezen|cnt|N|SELECT count(*) FROM public.document_aanvragen WHERE id = ''{DM}''',
    'anon|aanvraag: lezen|cnt|N|SELECT count(*) FROM public.document_aanvragen WHERE id = ''{DM}''',
    'anon|aanvraag: indienen|dml|N|INSERT INTO public.document_aanvragen (user_id, vraag, status, tenant_id) VALUES (''{UX}'', ''x'', ''nieuw'', ''{T}'')',
    'server|aanvraag: indienen|dml|Y|INSERT INTO public.document_aanvragen (user_id, vraag, status, tenant_id) VALUES (''{UX}'', ''x'', ''nieuw'', ''{T}'')',
    -- B-08 rapporten
    'medewerker|rapport: plaatsen|dml|N|INSERT INTO public.rapporten (tenant_id, maand, inhoud) VALUES (''{T}'', ''test'', ''{}''::jsonb)',
    'teamleider|rapport: plaatsen|dml|N|INSERT INTO public.rapporten (tenant_id, maand, inhoud) VALUES (''{T}'', ''test'', ''{}''::jsonb)',
    'hr|rapport: plaatsen|dml|N|INSERT INTO public.rapporten (tenant_id, maand, inhoud) VALUES (''{T}'', ''test'', ''{}''::jsonb)',
    'beheerder|rapport: plaatsen|dml|Y|INSERT INTO public.rapporten (tenant_id, maand, inhoud) VALUES (''{T}'', ''test'', ''{}''::jsonb)',
    'beheerder|rapport: plaatsen bij andere organisatie|dml|N|INSERT INTO public.rapporten (tenant_id, maand, inhoud) VALUES (''{T2}'', ''test'', ''{}''::jsonb)',
    'andere_admin|rapport: plaatsen bij deze organisatie|dml|N|INSERT INTO public.rapporten (tenant_id, maand, inhoud) VALUES (''{T}'', ''test'', ''{}''::jsonb)',
    'anon|rapport: plaatsen|dml|N|INSERT INTO public.rapporten (tenant_id, maand, inhoud) VALUES (''{T}'', ''test'', ''{}''::jsonb)',
    'medewerker|rapport: lezen|cnt|N|SELECT count(*) FROM public.rapporten WHERE tenant_id = ''{T}'''
  ];
  v_test text; v_d text[]; v_sql text; v_actor int; v_n bigint; v_ok boolean;
  v_uit text := ''; v_verschil int := 0; v_totaal int := 0;
  i int;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_t2 FROM public.tenants WHERE id <> v_t LIMIT 1;

  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now() FROM unnest(v_users) AS u;
  FOR i IN 1..6 LOOP
    INSERT INTO public.profiles (user_id, email, naam, role, tenant_id, teams)
    VALUES (v_users[i], 'rechtentest-' || v_users[i] || '@example.invalid', 'Rechtentest ' || v_namen[i], v_rollen[i],
            CASE WHEN v_namen[i] = 'andere_admin' THEN v_t2 ELSE v_t END,
            CASE WHEN v_namen[i] IN ('teamleider','medewerker','collega') THEN ARRAY['Rechtentest team'] ELSE NULL END)
    RETURNING id INTO v_p;
    v_prof := v_prof || v_p;
    IF v_tlrol[i] IS NOT NULL THEN
      INSERT INTO public.teamleiders (tenant_id, naam, email, rol, teams)
      VALUES (v_t, 'Rechtentest ' || v_namen[i], upper('rechtentest-' || v_users[i] || '@example.invalid'), v_tlrol[i],
              CASE WHEN v_tlrol[i] = 'teamleider' THEN ARRAY['Rechtentest team'] ELSE ARRAY[]::text[] END);
    END IF;
  END LOOP;

  INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord) VALUES (v_t, v_prof[4], 'rechtentest', 'x') RETURNING id INTO c_m;
  INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord) VALUES (v_t, v_prof[3], 'rechtentest', 'x') RETURNING id INTO c_tl;
  INSERT INTO public.conversations (tenant_id, user_id, vraag, antwoord) VALUES (v_t, v_prof[6], 'rechtentest', 'x') RETURNING id INTO c_x;
  INSERT INTO public.document_aanvragen (tenant_id, user_id, vraag, status) VALUES (v_t, v_users[4], 'rechtentest', 'nieuw') RETURNING id INTO d_m;
  INSERT INTO public.document_aanvragen (tenant_id, user_id, vraag, status) VALUES (v_t, v_users[6], 'rechtentest', 'nieuw') RETURNING id INTO d_x;

  FOREACH v_test IN ARRAY v_tests LOOP
    v_d := string_to_array(v_test, '|');
    v_actor := array_position(v_namen, v_d[1]);
    v_sql := v_d[5];
    v_sql := replace(v_sql, '{T2}', v_t2::text);
    v_sql := replace(v_sql, '{T}', v_t::text);
    v_sql := replace(v_sql, '{CM}', c_m::text);
    v_sql := replace(v_sql, '{CTL}', c_tl::text);
    v_sql := replace(v_sql, '{CX}', c_x::text);
    v_sql := replace(v_sql, '{DM}', d_m::text);
    v_sql := replace(v_sql, '{DX}', d_x::text);
    v_sql := replace(v_sql, '{PM}', v_prof[4]::text);
    v_sql := replace(v_sql, '{UX}', v_users[6]::text);
    IF v_actor IS NOT NULL THEN
      v_sql := replace(v_sql, '{PSELF}', v_prof[v_actor]::text);
      v_sql := replace(v_sql, '{USELF}', v_users[v_actor]::text);
    END IF;

    IF v_d[1] = 'server' THEN
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
      SET LOCAL ROLE service_role;
    ELSIF v_d[1] = 'anon' THEN
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
      SET LOCAL ROLE anon;
    ELSE
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[v_actor], 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
    END IF;
    BEGIN
      IF v_d[3] = 'cnt' THEN
        EXECUTE v_sql INTO v_n;
      ELSE
        EXECUTE v_sql;
        GET DIAGNOSTICS v_n = ROW_COUNT;
      END IF;
      IF v_n > 0 THEN RAISE EXCEPTION USING ERRCODE = 'WG001'; END IF;
      v_ok := false;
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    RESET ROLE;

    v_totaal := v_totaal + 1;
    v_uit := v_uit || format(E'\n%s | %s | %s | verwacht na: %s%s', v_d[1], v_d[2], CASE WHEN v_ok THEN 'Y' ELSE 'N' END, v_d[4],
                             CASE WHEN (CASE WHEN v_ok THEN 'Y' ELSE 'N' END) <> v_d[4] THEN ' | VERSCHIL' ELSE '' END);
    IF (CASE WHEN v_ok THEN 'Y' ELSE 'N' END) <> v_d[4] THEN v_verschil := v_verschil + 1; END IF;
  END LOOP;

  RAISE EXCEPTION 'RECHTENTEST (alles teruggedraaid): % acties, % wijken af van de verwachting na de migraties%', v_totaal, v_verschil, v_uit;
END $$;
