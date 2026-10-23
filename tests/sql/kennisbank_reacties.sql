-- Rechtentest migratie 102 (kennisbank_reacties + kennisbank_overzicht()).
-- Rollen: beheerder, HR, teamleider, medewerker, beheerder en HR van een andere organisatie.
-- Alles in één transactie die aan het eind altijd wordt teruggedraaid (RAISE);
-- geslaagde schrijfacties worden per stuk meteen teruggedraaid.
--
-- Kolommen per persoon:
--  L  leest de reactie van de HR-medewerker
--  I  voegt een reactie in (eigen naam, eigen organisatie, status nieuw) voor organisatie 1
--  S  voegt een reactie in die al 'afgehandeld' is (moet voor iedereen mislukken)
--  U  wijzigt status/antwoord van de reactie
--  D  verwijdert de reactie
--  O  overzicht bevat het testdocument van organisatie 1
--  P  overzicht bevat het persoonlijke document of de documentinhoud (moet N zijn)
--  R  leest documents rechtstreeks (ongewijzigde regel: alleen beheerder)

DO $$
DECLARE
  v_t uuid; v_ander_t uuid;
  v_namen text[] := ARRAY['beheerder','hr','teamleider','medewerker','andere_admin','andere_hr'];
  v_users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_rollen text[] := ARRAY['admin','teamleider','teamleider','medewerker','admin','teamleider'];
  v_tlrol text[]  := ARRAY[NULL, 'hr', 'teamleider', NULL, NULL, 'hr'];
  v_org text[]    := ARRAY['1','1','1','1','2','2'];
  v_profielen uuid[] := ARRAY[]::uuid[];
  v_p uuid;
  v_verwacht text[] := ARRAY[
    -- L I S U D O P R
    'YNNYNYNY',   -- beheerder
    'YYNNNYNN',   -- hr
    'NNNNNNNN',   -- teamleider
    'NNNNNNNN',   -- medewerker
    'NNNNNNNN',   -- andere_admin
    'NNNNNNNN'];  -- andere_hr
  r_reactie uuid; r_doc uuid; r_pers uuid;
  v_n bigint; v_ok boolean; v_res text; v_j jsonb;
  v_rij text; v_matrix text := ''; v_fouten text := '';
  i int;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;
  IF v_t IS NULL OR v_ander_t IS NULL THEN RAISE EXCEPTION 'MISLUKT: organisaties niet gevonden'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now()
    FROM unnest(v_users) AS u;
  FOR i IN 1..6 LOOP
    INSERT INTO public.profiles (user_id, email, naam, role, tenant_id, teams)
    VALUES (v_users[i], 'rechtentest-' || v_users[i] || '@example.invalid', 'Rechtentest ' || v_namen[i], v_rollen[i],
            CASE WHEN v_org[i] = '1' THEN v_t ELSE v_ander_t END,
            CASE WHEN v_tlrol[i] = 'teamleider' THEN ARRAY['Rechtentest team'] ELSE NULL END)
    RETURNING id INTO v_p;
    v_profielen := v_profielen || v_p;
    IF v_tlrol[i] IS NOT NULL THEN
      INSERT INTO public.teamleiders (tenant_id, naam, email, rol, teams)
      VALUES (CASE WHEN v_org[i] = '1' THEN v_t ELSE v_ander_t END, 'Rechtentest ' || v_namen[i],
              upper('rechtentest-' || v_users[i] || '@example.invalid'), v_tlrol[i],
              CASE WHEN v_tlrol[i] = 'teamleider' THEN ARRAY['Rechtentest team'] ELSE ARRAY[]::text[] END);
    END IF;
  END LOOP;

  INSERT INTO public.documents (tenant_id, naam, map, content, bestandspad)
    VALUES (v_t, 'Rechtentest document', 'Rechtentest', 'RECHTENTEST_INHOUD', 'rechtentest/pad') RETURNING id INTO r_doc;
  INSERT INTO public.documents (tenant_id, naam, user_id, content, bestandspad)
    VALUES (v_t, 'Rechtentest persoonlijk', v_profielen[4], 'x', 'rechtentest/pers') RETURNING id INTO r_pers;
  INSERT INTO public.kennisbank_reacties (tenant_id, ingediend_door, soort, verwijzing_type, verwijzing_id, verwijzing_naam, tekst)
    VALUES (v_t, v_profielen[2], 'verouderd', 'document', r_doc, 'Rechtentest document', 'Rechtentest reactie')
    RETURNING id INTO r_reactie;

  FOR i IN 1..6 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_rij := '';

    -- L
    SELECT count(*) INTO v_n FROM public.kennisbank_reacties WHERE id = r_reactie;
    v_rij := v_rij || CASE WHEN v_n > 0 THEN 'Y' ELSE 'N' END;

    -- I
    BEGIN
      INSERT INTO public.kennisbank_reacties (tenant_id, ingediend_door, soort, tekst)
        VALUES (v_t, v_profielen[i], 'ontbrekend_document', 'Rechtentest');
      RAISE EXCEPTION USING ERRCODE = 'WG001';
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    v_rij := v_rij || CASE WHEN v_ok THEN 'Y' ELSE 'N' END;

    -- S
    BEGIN
      INSERT INTO public.kennisbank_reacties (tenant_id, ingediend_door, soort, tekst, status, antwoord_beheerder)
        VALUES (v_t, v_profielen[i], 'overig', 'Rechtentest', 'afgehandeld', 'zelf goedgekeurd');
      RAISE EXCEPTION USING ERRCODE = 'WG001';
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    v_rij := v_rij || CASE WHEN v_ok THEN 'Y' ELSE 'N' END;

    -- U
    BEGIN
      UPDATE public.kennisbank_reacties SET status = 'afgehandeld', antwoord_beheerder = 'Rechtentest' WHERE id = r_reactie;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN RAISE EXCEPTION USING ERRCODE = 'WG001'; END IF;
      v_ok := false;
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    v_rij := v_rij || CASE WHEN v_ok THEN 'Y' ELSE 'N' END;

    -- D
    BEGIN
      DELETE FROM public.kennisbank_reacties WHERE id = r_reactie;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN RAISE EXCEPTION USING ERRCODE = 'WG001'; END IF;
      v_ok := false;
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    v_rij := v_rij || CASE WHEN v_ok THEN 'Y' ELSE 'N' END;

    -- O en P
    BEGIN
      v_j := public.kennisbank_overzicht();
      v_res := v_j::text;
    EXCEPTION WHEN OTHERS THEN v_res := NULL;
    END;
    v_rij := v_rij || CASE WHEN v_res IS NOT NULL AND position(r_doc::text IN v_res) > 0 THEN 'Y' ELSE 'N' END;
    v_rij := v_rij || CASE WHEN v_res IS NOT NULL AND (position(r_pers::text IN v_res) > 0
                                                     OR position('RECHTENTEST_INHOUD' IN v_res) > 0
                                                     OR position('bestandspad' IN v_res) > 0) THEN 'Y' ELSE 'N' END;

    -- R
    SELECT count(*) INTO v_n FROM public.documents WHERE id = r_doc;
    v_rij := v_rij || CASE WHEN v_n > 0 THEN 'Y' ELSE 'N' END;

    RESET ROLE;
    v_matrix := v_matrix || format(' %s:%s', v_namen[i], v_rij);
    IF v_rij <> v_verwacht[i] THEN
      v_fouten := v_fouten || format(' [%s: %s, verwacht %s]', v_namen[i], v_rij, v_verwacht[i]);
    END IF;
  END LOOP;

  -- anon mag niets
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM count(*) FROM public.kennisbank_reacties;
    v_fouten := v_fouten || ' [anon leest tabel]';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.kennisbank_overzicht();
    v_fouten := v_fouten || ' [anon roept overzicht aan]';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX (L I S U D O P R):%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: 6 personen + anon, zoals verwacht (alles teruggedraaid) || MATRIX (L I S U D O P R):%', v_matrix;
END $$;
