-- Rechtenmatrix (migratie 096): wie mag per tabel lezen en schrijven?
-- Rollen: medewerker, teamleider met rij, teamleider ZONDER rij, HR, manager,
-- admin en een HR-leidinggevende uit een andere organisatie.
-- Alles gebeurt in één transactie die aan het eind altijd wordt teruggedraaid
-- (RAISE); ook geslaagde schrijfacties worden per stuk direct teruggedraaid.
-- Uitkomst in de foutmelding: "GESLAAGD ..." of "MISLUKT ..." met de matrix.
--
-- Lezen  = ziet de testrij van de eigen organisatie (AHMN).
-- Schrijven = een insert of update op die organisatie lukt (zie per tabel hieronder).

DO $$
DECLARE
  v_t uuid;           -- eigen organisatie
  v_ander_t uuid;     -- andere organisatie
  -- personen
  v_namen text[] := ARRAY['medewerker','tl_met_rij','tl_zonder_rij','hr','manager','admin','andere_org'];
  v_users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                          gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_rollen text[] := ARRAY['medewerker','teamleider','teamleider','teamleider','teamleider','admin','teamleider'];
  v_tlrol text[]  := ARRAY[NULL, 'teamleider', NULL, 'hr', 'manager', NULL, 'hr'];
  v_eigenaar uuid := gen_random_uuid();   -- medewerker van wie de scores zijn
  v_eigenaar_profiel uuid;
  v_tl_profiel uuid;
  v_profielen uuid[] := ARRAY[]::uuid[];
  -- testrijen
  r_melding uuid; r_score uuid; r_quiz uuid; r_setting uuid; r_tl uuid; r_trend uuid;
  r_check uuid; r_docaanvraag uuid; r_aanvraag uuid; r_audit uuid;
  -- tabellen: naam, leesquery, schrijfquery (%1$L = organisatie, %2$L = eigen profiel, %3$L = persoon-index)
  v_tabellen text[] := ARRAY['profiles','meldingen','vertrouwens_scores','quiz_resultaten','settings',
                             'teamleiders','trendanalyse_rapporten','onboarding_checklist',
                             'document_aanvragen_beheer','aanvragen','audit_log','audit_log_andere_naam'];
  v_lees text[];
  v_schrijf text[];
  -- verwachting per tabel: lezen / schrijven, per persoon in de volgorde van v_namen
  -- meldingen schrijven: alleen admin (migratie 098); audit_log: alleen admin, op eigen naam (099).
  v_verwacht_l text[] := ARRAY['NYNYYYN','NYNYYYN','NYNYYYN','NYNYYYN','NYNYYYN','YYYYYYN','NYNYYYN','NYNYYYN','NYNNNYN','NYNNNYN','NNNNNYN','NNNNNYN'];
  v_verwacht_s text[] := ARRAY['NNNNNYN','NNNNNYN','NNNNNNN','NNNNNNN','NNNNNYN','NNNNNYN','NYNYYYN','NNNYNNN','NYNYYNN','NYNYYYN','NNNNNYN','NNNNNNN'];
  v_l text; v_s text;
  v_matrix text := '';
  v_fouten text := '';
  v_n bigint;
  v_ok boolean;
  i int; j int;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;
  IF v_t IS NULL OR v_ander_t IS NULL THEN RAISE EXCEPTION 'MISLUKT: organisaties niet gevonden'; END IF;

  -- ---- personen ----
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now()
    FROM unnest(v_users || v_eigenaar) AS u;
  FOR i IN 1..7 LOOP
    INSERT INTO public.profiles (user_id, email, naam, role, tenant_id)
    VALUES (v_users[i], 'rechtentest-' || v_users[i] || '@example.invalid', 'Rechtentest ' || v_namen[i],
            v_rollen[i], CASE WHEN v_namen[i] = 'andere_org' THEN v_ander_t ELSE v_t END)
    RETURNING id INTO v_eigenaar_profiel;
    v_profielen := v_profielen || v_eigenaar_profiel;
    IF v_tlrol[i] IS NOT NULL THEN
      INSERT INTO public.teamleiders (tenant_id, naam, email, rol)
      VALUES (CASE WHEN v_namen[i] = 'andere_org' THEN v_ander_t ELSE v_t END, 'Rechtentest ' || v_namen[i],
              upper('rechtentest-' || v_users[i] || '@example.invalid'), v_tlrol[i])
      RETURNING id INTO r_tl;
    END IF;
  END LOOP;
  v_tl_profiel := v_profielen[2];
  INSERT INTO public.profiles (user_id, email, naam, role, tenant_id)
  VALUES (v_eigenaar, 'rechtentest-' || v_eigenaar || '@example.invalid', 'Rechtentest eigenaar', 'medewerker', v_t)
  RETURNING id INTO v_eigenaar_profiel;

  -- ---- testrijen in de eigen organisatie ----
  INSERT INTO public.meldingen (tenant_id, type, bericht) VALUES (v_t, 'rechtentest', 'x') RETURNING id INTO r_melding;
  INSERT INTO public.vertrouwens_scores (user_id, tenant_id, week_nummer, score, gedeeld) VALUES (v_eigenaar, v_t, 1, 5, true) RETURNING id INTO r_score;
  INSERT INTO public.quiz_resultaten (user_id, tenant_id, week_nummer, score, gedeeld) VALUES (v_eigenaar, v_t, 1, 5, true) RETURNING id INTO r_quiz;
  INSERT INTO public.settings (tenant_id, sleutel, waarde) VALUES (v_t, 'rechtentest_geheim', 'x') RETURNING id INTO r_setting;
  SELECT id INTO r_tl FROM public.teamleiders WHERE naam = 'Rechtentest tl_met_rij';
  INSERT INTO public.trendanalyse_rapporten (tenant_id, tekst) VALUES (v_t, 'rechtentest') RETURNING id INTO r_trend;
  INSERT INTO public.onboarding_checklist (tenant_id, stap_naam) VALUES (v_t, 'Rechtentest stap') RETURNING id INTO r_check;
  INSERT INTO public.document_aanvragen_beheer (tenant_id, ingediend_door, bestandsnaam, bestandspad, toelichting)
    VALUES (v_t, v_tl_profiel, 'a', 'b', 'c') RETURNING id INTO r_docaanvraag;
  INSERT INTO public.aanvragen (tenant_id, aangevraagd_door) VALUES (v_t, v_tl_profiel) RETURNING id INTO r_aanvraag;
  INSERT INTO public.audit_log (tenant_id, actie) VALUES (v_t, 'RECHTENTEST') RETURNING id INTO r_audit;

  v_lees := ARRAY[
    format('SELECT count(*) FROM public.profiles WHERE id = %L', v_eigenaar_profiel),
    format('SELECT count(*) FROM public.meldingen WHERE id = %L', r_melding),
    format('SELECT count(*) FROM public.vertrouwens_scores WHERE id = %L', r_score),
    format('SELECT count(*) FROM public.quiz_resultaten WHERE id = %L', r_quiz),
    format('SELECT count(*) FROM public.settings WHERE id = %L', r_setting),
    format('SELECT count(*) FROM public.teamleiders WHERE id = %L', r_tl),
    format('SELECT count(*) FROM public.trendanalyse_rapporten WHERE id = %L', r_trend),
    format('SELECT count(*) FROM public.onboarding_checklist WHERE id = %L', r_check),
    format('SELECT count(*) FROM public.document_aanvragen_beheer WHERE id = %L', r_docaanvraag),
    format('SELECT count(*) FROM public.aanvragen WHERE id = %L', r_aanvraag),
    format('SELECT count(*) FROM public.audit_log WHERE id = %L', r_audit),
    format('SELECT count(*) FROM public.audit_log WHERE id = %L', r_audit)];
  v_schrijf := ARRAY[
    format('UPDATE public.profiles SET naam = ''Rechtentest gewijzigd'' WHERE id = %L', v_eigenaar_profiel),
    'INSERT INTO public.meldingen (tenant_id, type, bericht) VALUES (%1$L, ''rechtentest'', ''y'')',
    format('UPDATE public.vertrouwens_scores SET score = 1 WHERE id = %L', r_score),
    format('UPDATE public.quiz_resultaten SET score = 1 WHERE id = %L', r_quiz),
    'INSERT INTO public.settings (tenant_id, sleutel, waarde) VALUES (%1$L, ''rechtentest_nieuw_'' || %3$L, ''y'')',
    'INSERT INTO public.teamleiders (tenant_id, naam, rol) VALUES (%1$L, ''Rechtentest nieuw'', ''teamleider'')',
    'INSERT INTO public.trendanalyse_rapporten (tenant_id, tekst) VALUES (%1$L, ''y'')',
    format('UPDATE public.onboarding_checklist SET afgerond = true WHERE id = %L', r_check),
    'INSERT INTO public.document_aanvragen_beheer (tenant_id, ingediend_door, bestandsnaam, bestandspad, toelichting) VALUES (%1$L, %2$L, ''a'', ''b'', ''c'')',
    'INSERT INTO public.aanvragen (tenant_id, aangevraagd_door) VALUES (%1$L, %2$L)',
    'INSERT INTO public.audit_log (tenant_id, user_id, actie) VALUES (%1$L, auth.uid(), ''RECHTENTEST'')',
    format('INSERT INTO public.audit_log (tenant_id, user_id, actie) VALUES (%%1$L, %L, ''RECHTENTEST'')', v_eigenaar)];

  -- ---- per persoon ----
  FOR i IN 1..7 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    FOR j IN 1..array_length(v_tabellen, 1) LOOP
      EXECUTE v_lees[j] INTO v_n;
      v_verwacht_l[j] := v_verwacht_l[j];  -- (leesbaarheid)
      v_l := CASE WHEN v_n > 0 THEN 'Y' ELSE 'N' END;
      BEGIN
        EXECUTE format(v_schrijf[j], v_t, v_profielen[i], i::text);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 THEN RAISE EXCEPTION USING ERRCODE = 'WG001'; END IF;
        v_ok := false;
      EXCEPTION
        WHEN SQLSTATE 'WG001' THEN v_ok := true;   -- gelukt; meteen teruggedraaid
        WHEN OTHERS THEN v_ok := false;
      END;
      v_s := CASE WHEN v_ok THEN 'Y' ELSE 'N' END;
      v_matrix := v_matrix || format(' %s/%s:%s%s', v_namen[i], v_tabellen[j], v_l, v_s);
      IF v_l <> substr(v_verwacht_l[j], i, 1) THEN
        v_fouten := v_fouten || format(' [%s leest %s: %s, verwacht %s]', v_namen[i], v_tabellen[j], v_l, substr(v_verwacht_l[j], i, 1));
      END IF;
      IF v_s <> substr(v_verwacht_s[j], i, 1) THEN
        v_fouten := v_fouten || format(' [%s schrijft %s: %s, verwacht %s]', v_namen[i], v_tabellen[j], v_s, substr(v_verwacht_s[j], i, 1));
      END IF;
    END LOOP;
    RESET ROLE;
  END LOOP;

  IF v_fouten <> '' THEN
    RAISE EXCEPTION 'MISLUKT:% || MATRIX:%', v_fouten, v_matrix;
  END IF;
  RAISE EXCEPTION 'GESLAAGD: 7 personen x 12 tabellen, lezen en schrijven zoals verwacht (alles teruggedraaid) || MATRIX:%', v_matrix;
END $$;
