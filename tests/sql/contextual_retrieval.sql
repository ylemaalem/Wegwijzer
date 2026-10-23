-- Rechtentest migratie 103 (Contextual Retrieval).
-- Rollen: beheerder, HR, teamleider, medewerker, beheerder van een andere organisatie, anon.
-- Verwacht: niemand behalve de server kan de _ctx-zoekfuncties aanroepen (zoals de
-- bestaande zoekfuncties); lezen van stukken (ook de nieuwe kolom context) volgt de
-- ongewijzigde tabelregel: alleen de eigen organisatie; schrijven kan niemand.
-- Alles in één transactie die aan het eind altijd wordt teruggedraaid (RAISE).
-- Kolommen: V = match_document_chunks_ctx, T = zoek_chunks_trefwoord_ctx,
--           L = leest context van een stuk uit organisatie 1, W = wijzigt context.

DO $$
DECLARE
  v_t uuid; v_ander_t uuid;
  v_namen text[] := ARRAY['beheerder','hr','teamleider','medewerker','andere_admin'];
  v_users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_rollen text[] := ARRAY['admin','teamleider','teamleider','medewerker','admin'];
  v_tlrol text[]  := ARRAY[NULL, 'hr', 'teamleider', NULL, NULL];
  v_verwacht text[] := ARRAY['NNYN','NNYN','NNYN','NNYN','NNNN'];
  v_chunk uuid; v_emb vector(1536);
  v_n bigint; v_ok boolean; v_rij text;
  v_matrix text := ''; v_fouten text := '';
  i int;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;
  SELECT id, embedding INTO v_chunk, v_emb FROM public.document_chunks WHERE org_id = v_t AND embedding IS NOT NULL LIMIT 1;
  IF v_t IS NULL OR v_ander_t IS NULL OR v_chunk IS NULL THEN RAISE EXCEPTION 'MISLUKT: testgegevens niet gevonden'; END IF;
  UPDATE public.document_chunks SET context = 'Rechtentest context' WHERE id = v_chunk;

  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now()
    FROM unnest(v_users) AS u;
  FOR i IN 1..5 LOOP
    INSERT INTO public.profiles (user_id, email, naam, role, tenant_id, teams)
    VALUES (v_users[i], 'rechtentest-' || v_users[i] || '@example.invalid', 'Rechtentest ' || v_namen[i], v_rollen[i],
            CASE WHEN v_namen[i] = 'andere_admin' THEN v_ander_t ELSE v_t END,
            CASE WHEN v_tlrol[i] = 'teamleider' THEN ARRAY['Rechtentest team'] ELSE NULL END);
    IF v_tlrol[i] IS NOT NULL THEN
      INSERT INTO public.teamleiders (tenant_id, naam, email, rol, teams)
      VALUES (v_t, 'Rechtentest ' || v_namen[i], upper('rechtentest-' || v_users[i] || '@example.invalid'), v_tlrol[i],
              CASE WHEN v_tlrol[i] = 'teamleider' THEN ARRAY['Rechtentest team'] ELSE ARRAY[]::text[] END);
    END IF;
  END LOOP;

  FOR i IN 1..5 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_rij := '';
    BEGIN
      PERFORM * FROM public.match_document_chunks_ctx(v_emb, v_t, 3, 0.0);
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_ok := false;
    END;
    v_rij := v_rij || CASE WHEN v_ok THEN 'Y' ELSE 'N' END;
    BEGIN
      PERFORM * FROM public.zoek_chunks_trefwoord_ctx('salaris', v_emb, v_t, 3);
      v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_ok := false;
    END;
    v_rij := v_rij || CASE WHEN v_ok THEN 'Y' ELSE 'N' END;
    SELECT count(*) INTO v_n FROM public.document_chunks WHERE id = v_chunk AND context = 'Rechtentest context';
    v_rij := v_rij || CASE WHEN v_n > 0 THEN 'Y' ELSE 'N' END;
    BEGIN
      UPDATE public.document_chunks SET context = 'gewijzigd' WHERE id = v_chunk;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN RAISE EXCEPTION USING ERRCODE = 'WG001'; END IF;
      v_ok := false;
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    v_rij := v_rij || CASE WHEN v_ok THEN 'Y' ELSE 'N' END;
    RESET ROLE;
    v_matrix := v_matrix || format(' %s:%s', v_namen[i], v_rij);
    IF v_rij <> v_verwacht[i] THEN v_fouten := v_fouten || format(' [%s: %s, verwacht %s]', v_namen[i], v_rij, v_verwacht[i]); END IF;
  END LOOP;

  SET LOCAL ROLE anon;
  BEGIN
    PERFORM * FROM public.match_document_chunks_ctx(v_emb, v_t, 3, 0.0);
    v_fouten := v_fouten || ' [anon roept zoekfunctie aan]';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RESET ROLE;

  -- De server (service_role) kan beide functies gebruiken.
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM public.match_document_chunks_ctx(v_emb, v_t, 3, 0.0);
  IF v_n = 0 THEN v_fouten := v_fouten || ' [server vindt niets met match_document_chunks_ctx]'; END IF;
  SELECT count(*) INTO v_n FROM public.zoek_chunks_trefwoord_ctx('Rechtentest context', v_emb, v_t, 3);
  IF v_n = 0 THEN v_fouten := v_fouten || ' [server vindt de context niet met zoek_chunks_trefwoord_ctx]'; END IF;
  RESET ROLE;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX (V T L W):%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: 5 personen + anon + server zoals verwacht (alles teruggedraaid) || MATRIX (V T L W):%', v_matrix;
END $$;
