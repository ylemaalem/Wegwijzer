-- 084: handle_new_user leest uit het uitnodigingsregister (stap 2 van 2 — ná de
-- Edge Function-deploy die het register vult, zie 083).
--
-- Geen openstaande uitnodiging (≤ 30 dagen oud) voor dit e-mailadres → geen
-- profiel. Een account zonder profiel kan niets: de Edge Function antwoordt
-- "Profiel niet gevonden" en RLS geeft geen rijen. Zelf een profiel aanmaken via
-- de API wordt tegengehouden door trg_bewaak_profielwijziging (082).
--
-- Gevolg voor beheer: een account dat handmatig in het Supabase-dashboard wordt
-- aangemaakt krijgt geen profiel meer; nodig mensen uit via het beheerscherm.

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

  INSERT INTO public.profiles (user_id, email, naam, role, functiegroep, tenant_id, afdeling)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(_uitnodiging.naam, ''),
    _uitnodiging.role,
    _functiegroep,
    _uitnodiging.tenant_id,
    NULLIF(TRIM(_uitnodiging.afdeling), '')
  );

  UPDATE public.uitnodigingen SET gebruikt_op = now() WHERE id = _uitnodiging.id;

  RETURN NEW;
END;
$function$;
