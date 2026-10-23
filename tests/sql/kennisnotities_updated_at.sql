-- Rechtentest migratie 104 (kennisnotities.updated_at). Rechten op kennisnotities
-- blijven: alleen de beheerder van de eigen organisatie leest en wijzigt.
-- Rollen: beheerder, HR, teamleider, medewerker, beheerder van een andere organisatie.
-- Ook: een wijziging door de beheerder zet updated_at op nu.
-- Alles in één transactie die aan het eind altijd wordt teruggedraaid (RAISE).
-- Kolommen: L = leest de notitie, W = wijzigt de notitie.

DO $$
DECLARE
  v_t uuid; v_ander_t uuid;
  v_namen text[] := ARRAY['beheerder','hr','teamleider','medewerker','andere_admin'];
  v_users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_rollen text[] := ARRAY['admin','teamleider','teamleider','medewerker','admin'];
  v_tlrol text[]  := ARRAY[NULL, 'hr', 'teamleider', NULL, NULL];
  v_verwacht text[] := ARRAY['YY','NN','NN','NN','NN'];
  r_notitie uuid; v_n bigint; v_ok boolean; v_rij text; v_upd timestamptz;
  v_matrix text := ''; v_fouten text := '';
  i int;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now() FROM unnest(v_users) AS u;
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
  INSERT INTO public.kennisnotities (tenant_id, originele_vraag, notitie, created_at, updated_at)
    VALUES (v_t, 'Rechtentest', 'oud', now() - interval '1 year', now() - interval '1 year') RETURNING id INTO r_notitie;

  FOR i IN 1..5 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.kennisnotities WHERE id = r_notitie;
    v_rij := CASE WHEN v_n > 0 THEN 'Y' ELSE 'N' END;
    BEGIN
      UPDATE public.kennisnotities SET notitie = 'nieuw' WHERE id = r_notitie RETURNING updated_at INTO v_upd;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN
        IF v_upd < now() - interval '1 minute' THEN v_fouten := v_fouten || ' [updated_at niet bijgewerkt]'; END IF;
        RAISE EXCEPTION USING ERRCODE = 'WG001';
      END IF;
      v_ok := false;
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    v_rij := v_rij || CASE WHEN v_ok THEN 'Y' ELSE 'N' END;
    RESET ROLE;
    v_matrix := v_matrix || format(' %s:%s', v_namen[i], v_rij);
    IF v_rij <> v_verwacht[i] THEN v_fouten := v_fouten || format(' [%s: %s, verwacht %s]', v_namen[i], v_rij, v_verwacht[i]); END IF;
  END LOOP;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX (L W):%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: 5 rollen zoals verwacht, updated_at bijgewerkt (alles teruggedraaid) || MATRIX (L W):%', v_matrix;
END $$;
