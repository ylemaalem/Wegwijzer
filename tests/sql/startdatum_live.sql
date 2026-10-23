-- Rechtentest startdatum live (settings.startdatum_live, 2026-10-23).
-- Geen schemawijziging: de instelling is een rij in settings met de bestaande regels.
-- Rollen: beheerder, HR, teamleider (met rij), medewerker, beheerder van een andere organisatie.
-- Alles in één transactie die aan het eind altijd wordt teruggedraaid (RAISE).
-- Verwacht: lezen = beheerder, HR, teamleider; wijzigen = alleen beheerder (eigen organisatie).

DO $$
DECLARE
  v_t uuid; v_ander_t uuid;
  v_namen text[] := ARRAY['beheerder','hr','teamleider','medewerker','andere_org'];
  v_users uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_rollen text[] := ARRAY['admin','teamleider','teamleider','medewerker','admin'];
  v_tlrol text[]  := ARRAY[NULL, 'hr', 'teamleider', NULL, NULL];
  v_teams text[]  := ARRAY[NULL, NULL, 'Rechtentest team', NULL, NULL];
  v_verwacht_l text := 'YYYNN';
  v_verwacht_w text := 'YNNNN';
  v_verwacht_i text := 'YNNNN';
  r_setting uuid;
  v_n bigint; v_l text; v_w text; v_i text; v_ok boolean;
  v_matrix text := ''; v_fouten text := '';
  i int;
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;
  IF v_t IS NULL OR v_ander_t IS NULL THEN RAISE EXCEPTION 'MISLUKT: organisaties niet gevonden'; END IF;

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
      VALUES (v_t, 'Rechtentest ' || v_namen[i], upper('rechtentest-' || v_users[i] || '@example.invalid'), v_tlrol[i],
              CASE WHEN v_teams[i] IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_teams[i]] END);
    END IF;
  END LOOP;

  -- Bestaande instelling vervangen door een testwaarde (teruggedraaid).
  DELETE FROM public.settings WHERE tenant_id = v_t AND sleutel = 'startdatum_live';
  INSERT INTO public.settings (tenant_id, sleutel, waarde) VALUES (v_t, 'startdatum_live', '2026-11-01') RETURNING id INTO r_setting;

  FOR i IN 1..5 LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_users[i], 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    -- lezen
    SELECT count(*) INTO v_n FROM public.settings WHERE id = r_setting;
    v_l := CASE WHEN v_n > 0 THEN 'Y' ELSE 'N' END;

    -- wijzigen (zoals de Beheer-pagina: upsert op tenant_id + sleutel → update)
    BEGIN
      UPDATE public.settings SET waarde = '2026-12-01', updated_at = now() WHERE id = r_setting;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN RAISE EXCEPTION USING ERRCODE = 'WG001'; END IF;
      v_ok := false;
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    v_w := CASE WHEN v_ok THEN 'Y' ELSE 'N' END;

    -- opnieuw aanmaken (rij eerst weg binnen een subtransactie, daarna insert)
    BEGIN
      RESET ROLE;
      DELETE FROM public.settings WHERE id = r_setting;
      SET LOCAL ROLE authenticated;
      INSERT INTO public.settings (tenant_id, sleutel, waarde) VALUES (v_t, 'startdatum_live', '2026-12-01');
      RAISE EXCEPTION USING ERRCODE = 'WG001';
    EXCEPTION WHEN SQLSTATE 'WG001' THEN v_ok := true; WHEN OTHERS THEN v_ok := false;
    END;
    SET LOCAL ROLE authenticated;
    v_i := CASE WHEN v_ok THEN 'Y' ELSE 'N' END;

    v_matrix := v_matrix || format(' %s:%s%s%s', v_namen[i], v_l, v_w, v_i);
    IF v_l <> substr(v_verwacht_l, i, 1) THEN v_fouten := v_fouten || format(' [%s leest: %s]', v_namen[i], v_l); END IF;
    IF v_w <> substr(v_verwacht_w, i, 1) THEN v_fouten := v_fouten || format(' [%s wijzigt: %s]', v_namen[i], v_w); END IF;
    IF v_i <> substr(v_verwacht_i, i, 1) THEN v_fouten := v_fouten || format(' [%s maakt aan: %s]', v_namen[i], v_i); END IF;
    RESET ROLE;
  END LOOP;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX (lezen/wijzigen/aanmaken):%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: 5 rollen, lezen/wijzigen/aanmaken zoals verwacht (alles teruggedraaid) || MATRIX:%', v_matrix;
END $$;
