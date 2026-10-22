-- Test voor public.controleer_accountverwijdering (migratie 094).
-- Draait altijd in één transactie die aan het eind wordt teruggedraaid (RAISE):
-- de tijdelijke accounts en profielen worden nooit vastgelegd.
-- Uitkomst staat in de foutmelding: "GESLAAGD ..." of "MISLUKT ...".

DO $$
DECLARE
  v_eigen_tenant uuid;
  v_ander_tenant uuid;
  v_superadmin uuid;
  v_admin uuid := gen_random_uuid();     -- tijdelijke gewone admin, eigen organisatie
  v_collega uuid := gen_random_uuid();   -- tijdelijke medewerker, eigen organisatie
  v_vreemd uuid := gen_random_uuid();    -- tijdelijke medewerker, andere organisatie
  v_zonder uuid := gen_random_uuid();    -- account zonder profiel
  v_collega_profiel uuid;
  v_vreemd_profiel uuid;
  v_fouten text := '';
  r text;
BEGIN
  SELECT s.user_id, p.tenant_id INTO v_superadmin, v_eigen_tenant
    FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_tenant FROM public.tenants WHERE id <> v_eigen_tenant LIMIT 1;
  IF v_eigen_tenant IS NULL OR v_ander_tenant IS NULL THEN
    RAISE EXCEPTION 'MISLUKT: geen superadmin of geen tweede organisatie gevonden';
  END IF;

  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  SELECT u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rechtentest-' || u || '@example.invalid', now(), now()
    FROM unnest(ARRAY[v_admin, v_collega, v_vreemd, v_zonder]) AS u;
  -- handle_new_user maakt zonder uitnodiging geen profiel; zelf toevoegen.
  INSERT INTO public.profiles (user_id, email, naam, role, tenant_id) VALUES
    (v_admin,   'rechtentest-' || v_admin   || '@example.invalid', 'Rechtentest admin',   'admin',      v_eigen_tenant),
    (v_collega, 'rechtentest-' || v_collega || '@example.invalid', 'Rechtentest collega', 'medewerker', v_eigen_tenant),
    (v_vreemd,  'rechtentest-' || v_vreemd  || '@example.invalid', 'Rechtentest vreemd',  'medewerker', v_ander_tenant);
  SELECT id INTO v_collega_profiel FROM public.profiles WHERE user_id = v_collega;
  SELECT id INTO v_vreemd_profiel FROM public.profiles WHERE user_id = v_vreemd;

  -- Moet geweigerd worden:
  r := public.controleer_accountverwijdering(v_admin, v_vreemd, NULL);
  IF r IS NULL THEN v_fouten := v_fouten || ' [andere organisatie toegestaan]'; END IF;
  r := public.controleer_accountverwijdering(v_admin, v_zonder, NULL);
  IF r IS NULL THEN v_fouten := v_fouten || ' [zonder profiel toegestaan]'; END IF;
  r := public.controleer_accountverwijdering(v_admin, v_admin, NULL);
  IF r IS NULL THEN v_fouten := v_fouten || ' [eigen account toegestaan]'; END IF;
  r := public.controleer_accountverwijdering(v_collega, v_admin, NULL);
  IF r IS NULL THEN v_fouten := v_fouten || ' [niet-admin toegestaan]'; END IF;
  r := public.controleer_accountverwijdering(v_admin, v_collega, v_vreemd_profiel);
  IF r IS NULL THEN v_fouten := v_fouten || ' [profiel van ander account toegestaan]'; END IF;
  r := public.controleer_accountverwijdering(v_admin, NULL, NULL);
  IF r IS NULL THEN v_fouten := v_fouten || ' [zonder user_id toegestaan]'; END IF;

  -- Moet toegestaan worden:
  r := public.controleer_accountverwijdering(v_admin, v_collega, v_collega_profiel);
  IF r IS NOT NULL THEN v_fouten := v_fouten || ' [eigen organisatie geweigerd: ' || r || ']'; END IF;
  r := public.controleer_accountverwijdering(v_superadmin, v_vreemd, NULL);
  IF r IS NOT NULL THEN v_fouten := v_fouten || ' [superadmin geweigerd: ' || r || ']'; END IF;

  IF v_fouten <> '' THEN
    RAISE EXCEPTION 'MISLUKT:%', v_fouten;
  END IF;
  RAISE EXCEPTION 'GESLAAGD: 8 gevallen goed (6 geweigerd, eigen organisatie en superadmin toegestaan)';
END $$;
