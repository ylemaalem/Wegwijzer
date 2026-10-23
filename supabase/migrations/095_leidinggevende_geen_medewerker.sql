-- Een leidinggevende (tabel teamleiders) mag geen e-mailadres krijgen dat bij
-- een medewerker van dezelfde organisatie hoort. Voorheen zette het beheerscherm
-- na het opslaan profiles.role op 'teamleider' voor dat adres, waardoor een
-- medewerker bij het BEWERKEN van een leidinggevende ongemerkt dashboardtoegang
-- kreeg (en de maandelijkse terugblik voor leidinggevenden ontving).
-- Die rolwijziging is uit admin.js verwijderd; deze trigger weigert de rij zelf.
-- Test: tests/sql/leidinggevende_geen_medewerker.sql (teruggedraaide transactie).

CREATE OR REPLACE FUNCTION public.weiger_medewerker_als_leidinggevende()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.tenant_id = NEW.tenant_id
       AND lower(p.email) = lower(btrim(NEW.email))
       AND COALESCE(p.role, 'medewerker') NOT IN ('teamleider', 'admin')
  ) THEN
    RAISE EXCEPTION 'Dit e-mailadres hoort bij een medewerker. Gebruik een ander e-mailadres voor de leidinggevende.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.weiger_medewerker_als_leidinggevende() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS teamleiders_geen_medewerker ON public.teamleiders;
CREATE TRIGGER teamleiders_geen_medewerker
  BEFORE INSERT OR UPDATE OF email, tenant_id ON public.teamleiders
  FOR EACH ROW EXECUTE FUNCTION public.weiger_medewerker_als_leidinggevende();
