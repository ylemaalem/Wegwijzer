-- Rechtentest documenten per team (migratie 114, 2026-10-27).
-- Geen RLS-wijziging: documents.teams valt onder de bestaande regels van documents;
-- de vier zoekfuncties kregen een extra parameter met dezelfde rechten (alleen service_role).
-- Rollen: beheerder, HR, teamleider (met rij), medewerker, beheerder van een andere organisatie.
-- Alles in één transactie die aan het eind altijd wordt teruggedraaid (RAISE).
-- Verwacht: teams lezen en wijzigen = alleen beheerder eigen organisatie;
-- zoekfuncties aanroepen = niemand (authenticated en anon niet).

DO $$
DECLARE
  v_t uuid; v_ander_t uuid; v_doc uuid; v_emb public.vector;
  v_namen text[] := ARRAY['beheerder','hr','teamleider','medewerker','andere_org'];
  v_users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_rollen text[] := ARRAY['admin','teamleider','teamleider','medewerker','admin'];
  v_tlrol text[]  := ARRAY[NULL, 'hr', 'teamleider', NULL, NULL];
  v_teams text[]  := ARRAY[NULL, NULL, 'Rechtentest team', NULL, NULL];
  v_verwacht_l text := 'YNNNN';
  v_verwacht_w text := 'YNNNN';
  v_n bigint; v_l text; v_w text; v_z text; v_ok boolean;
  v_matrix text := ''; v_fouten text := '';
  i int;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;
  SELECT d.id INTO v_doc FROM public.documents d WHERE d.tenant_id = v_t AND d.user_id IS NULL LIMIT 1;
  SELECT dc.embedding INTO v_emb FROM public.document_chunks dc WHERE dc.embedding IS NOT NULL LIMIT 1;
  IF v_t IS NULL OR v_ander_t IS NULL OR v_doc IS NULL THEN RAISE EXCEPTION 'MISLUKT: organisaties of document niet gevonden'; END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now()
    FROM unnest(v_users) AS u;
  FOR i IN 1..5 LOOP
    INSERT INTO public.profiles (user_id, email, naam, role, tenant_id, teams)
    VALUES (v_users[i], 'rechtentest-' || v_users[i] || '@example.invalid', 'Rechtentest ' || v_namen[i], v_rollen[i],
            CASE WHEN v_namen[i] = 'andere_org' THEN v_ander_t ELSE v_t END,
            CASE WHEN v_teams[i] IS NULL THEN NULL ELSE ARRAY[v_teams[i]] END);
    IF v_tlrol[i] IS NOT NULL THEN
      INSERT INTO public.teamleiders (tenant_id, naam, email, rol, teams)
      VALUES (v_t, 'Rechtentest ' || v_namen[i], 'rechtentest-' || v_users[i] || '@example.invalid', v_tlrol[i],
              CASE WHEN v_teams[i] IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_teams[i]] END);
    END IF;
  END LOOP;

  FOR i IN 1..5 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    -- teams lezen
    SELECT count(*) INTO v_n FROM public.documents WHERE id = v_doc AND teams IS NOT NULL;
    v_l := CASE WHEN v_n > 0 THEN 'Y' ELSE 'N' END;

    -- teams wijzigen (zoals de Beheer-pagina)
    BEGIN
      UPDATE public.documents SET teams = ARRAY['Rechtentest team'] WHERE id = v_doc;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN RAISE EXCEPTION USING ERRCODE = 'WG001'; END IF;
      v_ok := false;
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    v_w := CASE WHEN v_ok THEN 'Y' ELSE 'N' END;

    -- zoekfuncties aanroepen (mag niet)
    v_z := '';
    BEGIN PERFORM public.match_document_chunks(v_emb, v_t, 1, 0.0, ARRAY[]::uuid[]); v_z := v_z || 'Y';
    EXCEPTION WHEN insufficient_privilege THEN v_z := v_z || 'N'; END;
    BEGIN PERFORM public.match_document_chunks_ctx(v_emb, v_t, 1, 0.0, ARRAY[]::uuid[]); v_z := v_z || 'Y';
    EXCEPTION WHEN insufficient_privilege THEN v_z := v_z || 'N'; END;
    BEGIN PERFORM public.zoek_chunks_trefwoord('test', v_emb, v_t, 1, ARRAY[]::uuid[]); v_z := v_z || 'Y';
    EXCEPTION WHEN insufficient_privilege THEN v_z := v_z || 'N'; END;
    BEGIN PERFORM public.zoek_chunks_trefwoord_ctx('test', v_emb, v_t, 1, ARRAY[]::uuid[]); v_z := v_z || 'Y';
    EXCEPTION WHEN insufficient_privilege THEN v_z := v_z || 'N'; END;

    v_matrix := v_matrix || format(' %s:%s%s/%s', v_namen[i], v_l, v_w, v_z);
    IF v_l <> substr(v_verwacht_l, i, 1) THEN v_fouten := v_fouten || format(' [%s leest teams: %s]', v_namen[i], v_l); END IF;
    IF v_w <> substr(v_verwacht_w, i, 1) THEN v_fouten := v_fouten || format(' [%s wijzigt teams: %s]', v_namen[i], v_w); END IF;
    IF v_z <> 'NNNN' THEN v_fouten := v_fouten || format(' [%s roept zoekfunctie aan: %s]', v_namen[i], v_z); END IF;
    RESET ROLE;
  END LOOP;

  -- anon: geen zoekfuncties
  IF has_function_privilege('anon', 'public.match_document_chunks(public.vector, uuid, integer, double precision, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.match_document_chunks_ctx(public.vector, uuid, integer, double precision, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.zoek_chunks_trefwoord(text, public.vector, uuid, integer, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.zoek_chunks_trefwoord_ctx(text, public.vector, uuid, integer, uuid[])', 'EXECUTE') THEN
    v_fouten := v_fouten || ' [anon mag een zoekfunctie aanroepen]';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.match_document_chunks(public.vector, uuid, integer, double precision, uuid[])', 'EXECUTE') THEN
    v_fouten := v_fouten || ' [service_role mist EXECUTE]';
  END IF;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX (lezen,wijzigen/zoekfuncties):%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: 5 rollen en anon zoals verwacht (alles teruggedraaid) || MATRIX:%', v_matrix;
END $$;
