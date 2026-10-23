-- Test voor trigger teamleiders_geen_medewerker (migratie 095).
-- Draait als een gewone admin (RLS aan) in één transactie die aan het eind
-- altijd wordt teruggedraaid (RAISE): niets wordt vastgelegd.
-- Uitkomst staat in de foutmelding: "GESLAAGD ..." of "MISLUKT ...".

DO $$
DECLARE
  v_tenant uuid;
  v_admin uuid := gen_random_uuid();
  v_medewerker uuid := gen_random_uuid();
  v_leiding uuid := gen_random_uuid();
  v_mail_mw text;
  v_mail_tl text;
  v_rij uuid;
  v_rol text;
  v_fouten text := '';
BEGIN
  SELECT p.tenant_id INTO v_tenant
    FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'MISLUKT: geen organisatie gevonden'; END IF;
  v_mail_mw := 'rechtentest-' || v_medewerker || '@example.invalid';
  v_mail_tl := 'rechtentest-' || v_leiding || '@example.invalid';

  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now()
    FROM unnest(ARRAY[v_admin, v_medewerker, v_leiding]) AS u;
  INSERT INTO public.profiles (user_id, email, naam, role, tenant_id) VALUES
    (v_admin,      'rechtentest-' || v_admin || '@example.invalid', 'Rechtentest admin', 'admin', v_tenant),
    (v_medewerker, v_mail_mw, 'Rechtentest medewerker', 'medewerker', v_tenant),
    (v_leiding,    v_mail_tl, 'Rechtentest leiding',    'teamleider', v_tenant);

  -- Vanaf hier als de tijdelijke admin, zoals het beheerscherm.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  INSERT INTO public.teamleiders (tenant_id, naam, email, rol)
    VALUES (v_tenant, 'Rechtentest leidinggevende', 'rechtentest-nieuw-' || v_admin || '@example.invalid', 'teamleider')
    RETURNING id INTO v_rij;
  IF v_rij IS NULL THEN RAISE EXCEPTION 'MISLUKT: admin kan geen leidinggevende toevoegen'; END IF;

  -- 1. Bewerken met het e-mailadres van een medewerker: geweigerd.
  BEGIN
    UPDATE public.teamleiders SET email = upper(v_mail_mw) WHERE id = v_rij;
    v_fouten := v_fouten || ' [bewerken met medewerker-adres toegestaan]';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- 2. Toevoegen met het e-mailadres van een medewerker: geweigerd.
  BEGIN
    INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES (v_tenant, 'x', ' ' || v_mail_mw, 'hr');
    v_fouten := v_fouten || ' [toevoegen met medewerker-adres toegestaan]';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- 3. Bewerken met het adres van een bestaande leidinggevende: toegestaan.
  BEGIN
    UPDATE public.teamleiders SET email = v_mail_tl WHERE id = v_rij;
  EXCEPTION WHEN check_violation THEN v_fouten := v_fouten || ' [leidinggevende-adres geweigerd]';
  END;
  -- 4. Andere velden bewerken (adres ongewijzigd) en een leeg adres: toegestaan.
  BEGIN
    UPDATE public.teamleiders SET naam = 'Rechtentest gewijzigd', email = NULL WHERE id = v_rij;
  EXCEPTION WHEN check_violation THEN v_fouten := v_fouten || ' [leeg adres geweigerd]';
  END;

  RESET ROLE;
  SELECT role INTO v_rol FROM public.profiles WHERE user_id = v_medewerker;
  IF v_rol IS DISTINCT FROM 'medewerker' THEN v_fouten := v_fouten || ' [rol medewerker veranderd in ' || v_rol || ']'; END IF;

  IF v_fouten <> '' THEN
    RAISE EXCEPTION 'MISLUKT:%', v_fouten;
  END IF;
  RAISE EXCEPTION 'GESLAAGD: 4 gevallen goed, rol medewerker ongewijzigd (alles teruggedraaid)';
END $$;
