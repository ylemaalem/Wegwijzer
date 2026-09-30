-- 080: nieuwe organisatie volledig seeden via de tenants-trigger.
--
-- Probleem: bij het aanmaken van een organisatie riep de frontend
-- (admin.js) seed_nieuwe_tenant() aan, maar EXECUTE daarop is in migratie 073
-- ingetrokken voor authenticated. Daardoor werden functiegroepen en
-- document-mappen niet meer aangemaakt (alleen de onboarding-checklist, die
-- al via de trigger liep). Oplossing: de trigger op tenants seedt nu ook de
-- functiegroepen en mappen (seed_nieuwe_tenant is idempotent, ON CONFLICT DO
-- NOTHING). De functie blijft afgeschermd; de frontend hoeft niets meer aan te
-- roepen (de aanroep is uit admin.js verwijderd).

CREATE OR REPLACE FUNCTION public.trigger_seed_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.seed_onboarding_checklist(NEW.id);
  PERFORM public.seed_nieuwe_tenant(NEW.id);
  RETURN NEW;
END;
$function$;
