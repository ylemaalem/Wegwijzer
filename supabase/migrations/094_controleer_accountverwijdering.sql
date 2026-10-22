-- 094: account verwijderen alleen binnen de eigen organisatie.
--
-- verwijder-gebruiker en de chat-tak delete_user verwijderden elk auth-account
-- op id, zonder te controleren bij welke organisatie het hoorde. Deze functie is
-- nu de enige beslisregel (beide Edge Functions roepen haar aan):
-- - alleen een admin;
-- - nooit het eigen account;
-- - een meegegeven profiel moet bij het account horen;
-- - de superadmin mag in elke organisatie;
-- - anders moet het account een profiel hebben, uitsluitend in de organisatie
--   van de admin.
-- Uitkomst: NULL = toegestaan, anders de reden (voor de beheerder).
-- Test: tests/sql/accountverwijdering.sql (teruggedraaide transactie).

CREATE OR REPLACE FUNCTION public.controleer_accountverwijdering(
  p_beller uuid,
  p_doel uuid,
  p_profiel uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_rol text;
  v_aantal integer;
  v_vreemd integer;
BEGIN
  IF p_doel IS NULL THEN
    RETURN 'user_id is verplicht';
  END IF;

  SELECT tenant_id, role INTO v_tenant, v_rol FROM public.profiles WHERE user_id = p_beller;
  IF v_rol IS DISTINCT FROM 'admin' THEN
    RETURN 'Alleen admins kunnen gebruikers verwijderen';
  END IF;
  IF p_doel = p_beller THEN
    RETURN 'Je kunt je eigen account niet verwijderen.';
  END IF;
  IF p_profiel IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_profiel AND user_id = p_doel
  ) THEN
    RETURN 'Dit profiel hoort niet bij dit account.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.superadmins WHERE user_id = p_beller) THEN
    RETURN NULL;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE tenant_id IS DISTINCT FROM v_tenant)
    INTO v_aantal, v_vreemd
    FROM public.profiles WHERE user_id = p_doel;
  IF v_aantal = 0 THEN
    RETURN 'Dit account heeft geen profiel in jouw organisatie. Er is niets verwijderd.';
  END IF;
  IF v_vreemd > 0 THEN
    RETURN 'Dit account hoort niet bij jouw organisatie. Er is niets verwijderd.';
  END IF;
  RETURN NULL;
END;
$function$;

-- Alleen de Edge Functions (service role) roepen dit aan.
REVOKE EXECUTE ON FUNCTION public.controleer_accountverwijdering(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.controleer_accountverwijdering(uuid, uuid, uuid) TO service_role;
