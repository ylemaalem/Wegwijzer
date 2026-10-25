-- 108: accounts met alleen het dashboard (D2, akkoord Younes 2026-10-25).
-- Een leidinggevende of HR-medewerker kan een account krijgen zonder kennisassistent.
-- - profiles.alleen_dashboard: de bron voor de toegang. De chatfunctie weigert vragen
--   (403, na de dashboardroutes) en route-guard.js stuurt medewerker.html door.
-- - uitnodigingen.alleen_dashboard: handle_new_user neemt de waarde over bij het
--   aanmaken van het profiel (nooit uit user_metadata, die kan de gebruiker zelf zetten).
-- - Alleen met role 'teamleider' (CHECK). Een gebruiker kan de kolom niet zelf wijzigen:
--   bewaak_profielwijziging laat zonder adminrol alleen vertrouwenscheck_actief en
--   rolwissel_gezien toe.
-- - Wordt de rij in teamleiders verwijderd, dan zet intrek_leidinggevende_rol de rol terug
--   naar 'medewerker' en nu ook alleen_dashboard naar false (een gewoon medewerkersaccount).
-- Rechtentest: tests/sql/alleen_dashboard.sql

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS alleen_dashboard boolean NOT NULL DEFAULT false;
ALTER TABLE public.uitnodigingen ADD COLUMN IF NOT EXISTS alleen_dashboard boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_alleen_dashboard_rol;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_alleen_dashboard_rol
  CHECK (NOT alleen_dashboard OR role = 'teamleider');
ALTER TABLE public.uitnodigingen DROP CONSTRAINT IF EXISTS uitnodigingen_alleen_dashboard_rol;
ALTER TABLE public.uitnodigingen ADD CONSTRAINT uitnodigingen_alleen_dashboard_rol
  CHECK (NOT alleen_dashboard OR role = 'teamleider');

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uitnodiging public.uitnodigingen%ROWTYPE;
  _functiegroep text;
BEGIN
  SELECT * INTO _uitnodiging
  FROM public.uitnodigingen
  WHERE lower(email) = lower(COALESCE(NEW.email, ''))
    AND gebruikt_op IS NULL
    AND created_at > now() - interval '30 days'
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF _uitnodiging.functiegroep IN (
    'ambulant_begeleider',
    'ambulant_persoonlijk_begeleider',
    'woonbegeleider',
    'persoonlijk_woonbegeleider'
  ) THEN
    _functiegroep := _uitnodiging.functiegroep;
  ELSE
    _functiegroep := NULL;
  END IF;

  INSERT INTO public.profiles (user_id, email, naam, role, functiegroep, tenant_id, afdeling, alleen_dashboard)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(_uitnodiging.naam, ''),
    _uitnodiging.role,
    _functiegroep,
    _uitnodiging.tenant_id,
    NULLIF(TRIM(_uitnodiging.afdeling), ''),
    COALESCE(_uitnodiging.alleen_dashboard, false) AND _uitnodiging.role = 'teamleider'
  );

  UPDATE public.uitnodigingen SET gebruikt_op = now() WHERE id = _uitnodiging.id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.intrek_leidinggevende_rol()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profiel record;
  v_uitvoerder_email text;
  v_uitvoerder_naam text;
BEGIN
  IF OLD.email IS NULL OR btrim(OLD.email) = '' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE'
     AND lower(btrim(COALESCE(NEW.email, ''))) = lower(btrim(OLD.email))
     AND NEW.tenant_id = OLD.tenant_id THEN
    RETURN NULL;
  END IF;
  -- Staat dit adres nog in een andere rij van dezelfde organisatie? Dan blijft de rol.
  IF EXISTS (SELECT 1 FROM public.teamleiders t
              WHERE t.tenant_id = OLD.tenant_id
                AND lower(btrim(t.email)) = lower(btrim(OLD.email))) THEN
    RETURN NULL;
  END IF;

  SELECT u.email, p.naam INTO v_uitvoerder_email, v_uitvoerder_naam
    FROM auth.users u LEFT JOIN public.profiles p ON p.user_id = u.id
   WHERE u.id = auth.uid();

  -- Nooit een admin terugzetten: alleen role 'teamleider' wordt 'medewerker'.
  -- Een account met alleen het dashboard wordt een gewoon medewerkersaccount (108).
  FOR v_profiel IN
    WITH oud AS (
      SELECT p.id, p.alleen_dashboard FROM public.profiles p
       WHERE p.tenant_id = OLD.tenant_id
         AND lower(btrim(p.email)) = lower(btrim(OLD.email))
         AND p.role = 'teamleider'
    )
    UPDATE public.profiles p
       SET role = 'medewerker', alleen_dashboard = false
      FROM oud
     WHERE p.id = oud.id
    RETURNING p.id, p.email, p.naam, oud.alleen_dashboard AS was_alleen_dashboard
  LOOP
    INSERT INTO public.audit_log (tenant_id, user_id, user_email, user_naam, actie, object_type, object_id, details)
    VALUES (OLD.tenant_id, auth.uid(), v_uitvoerder_email, v_uitvoerder_naam,
            'LEIDINGGEVENDE_ROL_INGETROKKEN', 'medewerker', v_profiel.id,
            jsonb_build_object('email', v_profiel.email, 'naam', v_profiel.naam,
                               'oude_rol', 'teamleider', 'nieuwe_rol', 'medewerker',
                               'alleen_dashboard_was', v_profiel.was_alleen_dashboard,
                               'teamleider_rij', OLD.id, 'leidinggevende_naam', OLD.naam,
                               'reden', CASE WHEN TG_OP = 'DELETE' THEN 'leidinggevende verwijderd'
                                             ELSE 'e-mailadres van de leidinggevende gewijzigd' END));
  END LOOP;
  RETURN NULL;
END;
$function$;
