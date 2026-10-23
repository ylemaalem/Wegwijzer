-- Test voor trigger teamleiders_intrek_rol (migratie 096): verwijderen van een
-- leidinggevende (of een ander e-mailadres) zet het profiel terug naar 'medewerker'
-- en schrijft dat in het auditlog; een admin wordt nooit teruggezet.
-- Draait als een gewone admin, in één transactie die altijd wordt teruggedraaid.

DO $$
DECLARE
  v_t uuid;
  v_admin uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();   -- leidinggevende die verwijderd wordt
  v_b uuid := gen_random_uuid();   -- leidinggevende met twee rijen
  v_c uuid := gen_random_uuid();   -- leidinggevende van wie het adres wordt gewijzigd
  v_rij_a uuid; v_rij_b1 uuid; v_rij_c uuid; v_rij_admin uuid;
  v_rol text;
  v_n int;
  v_fouten text := '';
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now()
    FROM unnest(ARRAY[v_admin, v_a, v_b, v_c]) AS u;
  INSERT INTO public.profiles (user_id, email, naam, role, tenant_id) VALUES
    (v_admin, 'rechtentest-' || v_admin || '@example.invalid', 'Rechtentest admin', 'admin', v_t),
    (v_a, 'rechtentest-' || v_a || '@example.invalid', 'Rechtentest A', 'teamleider', v_t),
    (v_b, 'rechtentest-' || v_b || '@example.invalid', 'Rechtentest B', 'teamleider', v_t),
    (v_c, 'rechtentest-' || v_c || '@example.invalid', 'Rechtentest C', 'teamleider', v_t);
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES (v_t, 'Rechtentest A', 'Rechtentest-' || v_a || '@example.invalid', 'teamleider') RETURNING id INTO v_rij_a;
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES (v_t, 'Rechtentest B1', 'rechtentest-' || v_b || '@example.invalid', 'teamleider') RETURNING id INTO v_rij_b1;
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES (v_t, 'Rechtentest B2', 'rechtentest-' || v_b || '@example.invalid', 'hr');
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES (v_t, 'Rechtentest C', 'rechtentest-' || v_c || '@example.invalid', 'manager') RETURNING id INTO v_rij_c;
  INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES (v_t, 'Rechtentest admin', 'rechtentest-' || v_admin || '@example.invalid', 'hr') RETURNING id INTO v_rij_admin;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  DELETE FROM public.teamleiders WHERE id = v_rij_a;        -- 1. verwijderen
  DELETE FROM public.teamleiders WHERE id = v_rij_b1;       -- 2. tweede rij blijft
  UPDATE public.teamleiders SET email = 'rechtentest-ander-' || v_c || '@example.invalid' WHERE id = v_rij_c;  -- 3. ander adres
  DELETE FROM public.teamleiders WHERE id = v_rij_admin;    -- 4. admin
  RESET ROLE;

  SELECT role INTO v_rol FROM public.profiles WHERE user_id = v_a;
  IF v_rol <> 'medewerker' THEN v_fouten := v_fouten || ' [A na verwijderen: ' || v_rol || ']'; END IF;
  SELECT count(*) INTO v_n FROM public.audit_log
   WHERE actie = 'LEIDINGGEVENDE_ROL_INGETROKKEN' AND object_id = (SELECT id FROM public.profiles WHERE user_id = v_a)::text
     AND user_id = v_admin AND details->>'reden' = 'leidinggevende verwijderd';
  IF v_n <> 1 THEN v_fouten := v_fouten || ' [auditregel A: ' || v_n || ']'; END IF;
  SELECT role INTO v_rol FROM public.profiles WHERE user_id = v_b;
  IF v_rol <> 'teamleider' THEN v_fouten := v_fouten || ' [B met tweede rij: ' || v_rol || ']'; END IF;
  SELECT role INTO v_rol FROM public.profiles WHERE user_id = v_c;
  IF v_rol <> 'medewerker' THEN v_fouten := v_fouten || ' [C na ander adres: ' || v_rol || ']'; END IF;
  SELECT role INTO v_rol FROM public.profiles WHERE user_id = v_admin;
  IF v_rol <> 'admin' THEN v_fouten := v_fouten || ' [admin teruggezet: ' || v_rol || ']'; END IF;
  SELECT count(*) INTO v_n FROM public.audit_log WHERE actie = 'LEIDINGGEVENDE_ROL_INGETROKKEN'
     AND details->>'email' LIKE 'rechtentest-%';
  IF v_n <> 2 THEN v_fouten := v_fouten || ' [aantal auditregels ' || v_n || ', verwacht 2]'; END IF;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:%', v_fouten; END IF;
  RAISE EXCEPTION 'GESLAAGD: verwijderen en ander adres zetten terug naar medewerker met auditregel; tweede rij en admin blijven (alles teruggedraaid)';
END $$;
