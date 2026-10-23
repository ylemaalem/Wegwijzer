-- Rechtentest bug 2026-10-23: een leidinggevende die via 📨 opnieuw werd uitgenodigd kreeg
-- profiles.role 'medewerker' en geen dashboard. Bootst per rol (teamleider, manager, HR) de
-- databasekant na van wat de Edge Function chat doet (rol uit teamleiders, zie
-- _shared/uitnodigingsrol.ts) en controleert daarna "inloggen": mijn_leidinggevende_rol()
-- en het lezen van profielen van de organisatie als die persoon.
-- Alles in één transactie, aan het eind teruggedraaid (RAISE).
--
-- Scenario's per rol:
--  N = nieuwe uitnodiging: register 'teamleider' -> account (handle_new_user) -> rij in teamleiders
--  O = opnieuw versturen zonder account: rij bestaat al, register 'teamleider' -> account
--  H = herstel van een fout profiel ('medewerker' + rij, zoals younesl@msn.com): role -> 'teamleider'
--  B = de oude fout (register 'medewerker' bij een rij) geeft GEEN dashboard (bewijs van de bug)
-- Plus: medewerker zonder rij, 'teamleider' zonder rij en een rij in een andere organisatie
-- geven geen toegang.
DO $$
DECLARE
  v_t uuid; v_ander_t uuid;
  v_rollen text[] := ARRAY['teamleider','manager','hr'];
  v_rol text; v_scen text; v_u uuid; v_email text; v_profielrol text; v_dash text; v_lees bigint;
  v_matrix text := ''; v_fouten text := ''; v_rij text;

  -- Maakt een account aan zoals Supabase Auth bij een uitnodiging (trigger handle_new_user).
  -- (inline herhaald in de lus; plpgsql kent geen geneste functies)
BEGIN
  SELECT p.tenant_id INTO v_t FROM public.superadmins s JOIN public.profiles p ON p.user_id = s.user_id LIMIT 1;
  SELECT id INTO v_ander_t FROM public.tenants WHERE id <> v_t LIMIT 1;

  FOREACH v_rol IN ARRAY v_rollen LOOP
    v_rij := '';
    FOREACH v_scen IN ARRAY ARRAY['N','O','H','B'] LOOP
      v_u := gen_random_uuid();
      v_email := 'rechtentest-' || lower(v_scen) || '-' || v_rol || '-' || v_u || '@example.invalid';

      IF v_scen IN ('O','H','B') THEN
        -- Rij bestaat al vóór het account (toegevoegd zonder account, of account later weg).
        INSERT INTO public.teamleiders (tenant_id, naam, email, rol, teams)
        VALUES (v_t, 'Rechtentest ' || v_rol, upper(v_email), v_rol,
                CASE WHEN v_rol = 'teamleider' THEN ARRAY['Rechtentest team'] ELSE NULL END);
      END IF;

      INSERT INTO public.uitnodigingen (tenant_id, email, naam, role)
      VALUES (v_t, v_email, 'Rechtentest ' || v_rol,
              CASE WHEN v_scen IN ('H','B') THEN 'medewerker' ELSE 'teamleider' END);
      INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
      VALUES (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email, now(), now());

      IF v_scen = 'N' THEN
        -- Beheerscherm slaat de rij pas ná een geslaagde uitnodiging op.
        INSERT INTO public.teamleiders (tenant_id, naam, email, rol, teams)
        VALUES (v_t, 'Rechtentest ' || v_rol, v_email, v_rol,
                CASE WHEN v_rol = 'teamleider' THEN ARRAY['Rechtentest team'] ELSE NULL END);
      END IF;
      IF v_scen = 'H' THEN
        -- Wat chat/index.ts doet bij 📨 voor een bestaand profiel met een rij.
        UPDATE public.profiles SET role = 'teamleider' WHERE user_id = v_u AND role = 'medewerker';
      END IF;

      SELECT role INTO v_profielrol FROM public.profiles WHERE user_id = v_u;
      -- "Inloggen" als deze persoon.
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      v_dash := public.mijn_leidinggevende_rol();
      SELECT count(*) INTO v_lees FROM public.profiles WHERE user_id <> v_u;
      RESET ROLE;

      v_rij := v_rij || format(' %s:%s/%s/%s', v_scen, COALESCE(v_profielrol, '-'), COALESCE(v_dash, '-'), CASE WHEN v_lees > 0 THEN 'leest' ELSE 'niets' END);
      IF v_scen = 'B' THEN
        IF v_profielrol <> 'medewerker' OR v_dash IS NOT NULL OR v_lees > 0 THEN
          v_fouten := v_fouten || format(' [%s %s: oude fout zou toegang geven]', v_rol, v_scen);
        END IF;
      ELSIF v_profielrol IS DISTINCT FROM 'teamleider' OR v_dash IS DISTINCT FROM v_rol OR v_lees = 0 THEN
        v_fouten := v_fouten || format(' [%s %s: rol %s, dashboard %s, leest %s]', v_rol, v_scen, v_profielrol, v_dash, v_lees);
      END IF;
    END LOOP;
    v_matrix := v_matrix || format(' | %s%s', v_rol, v_rij);
  END LOOP;

  -- Geen toegang zonder (eigen) rij.
  FOREACH v_scen IN ARRAY ARRAY['medewerker_zonder_rij','teamleider_zonder_rij','rij_andere_org'] LOOP
    v_u := gen_random_uuid();
    v_email := 'rechtentest-' || replace(v_scen, '_', '-') || '-' || v_u || '@example.invalid';
    IF v_scen = 'rij_andere_org' THEN
      INSERT INTO public.teamleiders (tenant_id, naam, email, rol) VALUES (v_ander_t, 'Rechtentest ander', v_email, 'hr');
    END IF;
    INSERT INTO public.uitnodigingen (tenant_id, email, naam, role)
    VALUES (v_t, v_email, 'Rechtentest', CASE WHEN v_scen = 'medewerker_zonder_rij' THEN 'medewerker' ELSE 'teamleider' END);
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    VALUES (v_u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v_email, now(), now());
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_dash := public.mijn_leidinggevende_rol();
    SELECT count(*) INTO v_lees FROM public.profiles WHERE user_id <> v_u;
    RESET ROLE;
    v_matrix := v_matrix || format(' | %s: %s/%s', v_scen, COALESCE(v_dash, '-'), CASE WHEN v_lees > 0 THEN 'leest' ELSE 'niets' END);
    IF v_dash IS NOT NULL OR v_lees > 0 THEN
      v_fouten := v_fouten || format(' [%s: krijgt toegang]', v_scen);
    END IF;
  END LOOP;

  IF v_fouten <> '' THEN RAISE EXCEPTION 'MISLUKT:% || MATRIX (profielrol/dashboard/lezen):%', v_fouten, v_matrix; END IF;
  RAISE EXCEPTION 'GESLAAGD: teamleider, manager en HR (nieuw, opnieuw, herstel) zoals verwacht; oude fout en zonder rij geen toegang (alles teruggedraaid) || MATRIX:%', v_matrix;
END $$;
