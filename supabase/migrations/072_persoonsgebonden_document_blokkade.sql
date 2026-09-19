-- =============================================
-- WEGWIJZER — Migratie 072
-- Persoonsgebonden documenten structureel uit de kennisbank houden (4C, harde laag)
-- =============================================
-- Gemeten op de kennisbank (155 documenten, 19-09-2026):
--  * Bestandsnaam "lijkt op Voornaam Achternaam": 22 treffers, alle vals-positief.
--  * BSN-/geboortedatum-trefwoorden in inhoud: 19 treffers, alle vals-positief.
--  * Bestandsnaam bevat de volledige naam van een bekende persoon: 0 treffers
--    op de huidige kennisbank, en zou beide eerder verwijderde checklists
--    (Iris Vlieger, Linda de Boer — beide in profiles) hebben tegengehouden.
-- Alleen dat laatste signaal is ruisvrij genoeg voor een harde blokkade. De
-- zwakkere signalen (naam in de inhoud, BSN volgens elfproef) zijn een
-- waarschuwing in het admin-scherm, niet hier.
--
-- Uitzonderingen, bewust:
--  * Persoonlijke documenten (user_id gezet) zijn per definitie persoonsgebonden
--    en worden via een apart pad voor één medewerker opgeslagen.
--  * Gecrawlde webpagina's: titel komt van de website; een blokkade zou het
--    crawlen afbreken.
--  * Admin-accounts tellen niet mee als naam: het systeemaccount heet
--    "Wegwijzer Beheer" en zou legitieme handleidingen blokkeren.
-- Ontsnapping: hernoem het bestand. Gaat het document niet over die persoon,
-- dan hoort de naam ook niet in de bestandsnaam.
-- =============================================

BEGIN;

-- Normaliseert tekst voor naamvergelijking: kleine letters, accenten weg,
-- alle niet-alfanumerieke tekens (_ - . , haakjes) worden spaties.
CREATE OR REPLACE FUNCTION public.normaliseer_naam(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(regexp_replace(
    translate(lower(coalesce(t, '')),
              'áàäâãåéèëêíìïîóòöôõúùüûçñý',
              'aaaaaaeeeeiiiiooooouuuucny'),
    '[^a-z0-9]+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.blokkeer_persoonsgebonden_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bestand text;
  v_naam    text;
BEGIN
  IF NEW.user_id IS NOT NULL OR COALESCE(NEW.is_crawled_page, false) THEN
    RETURN NEW;
  END IF;

  v_bestand := ' ' || public.normaliseer_naam(NEW.naam) || ' ';

  SELECT n.naam INTO v_naam
  FROM (
    SELECT p.naam FROM public.profiles p
     WHERE p.tenant_id = NEW.tenant_id AND COALESCE(p.role, '') NOT IN ('admin', 'superadmin')
    UNION
    SELECT t.naam FROM public.teamleiders t WHERE t.tenant_id = NEW.tenant_id
    UNION
    SELECT a.medewerker_naam FROM public.aanvragen a WHERE a.tenant_id = NEW.tenant_id
  ) n
  WHERE n.naam ~ '\S+\s+\S+'
    AND length(public.normaliseer_naam(n.naam)) >= 6
    AND v_bestand LIKE '% ' || public.normaliseer_naam(n.naam) || ' %'
  LIMIT 1;

  IF v_naam IS NOT NULL THEN
    RAISE EXCEPTION 'PERSOONSGEBONDEN_DOCUMENT: de bestandsnaam bevat de naam van een medewerker (%). Persoonsgebonden documenten horen niet in de kennisbank. Gaat het document niet over deze persoon? Hernoem dan het bestand.', v_naam
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blokkeer_persoonsgebonden_document ON public.documents;
CREATE TRIGGER trg_blokkeer_persoonsgebonden_document
  BEFORE INSERT OR UPDATE OF naam ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.blokkeer_persoonsgebonden_document();

-- Niet rechtstreeks aanroepbaar via de API; triggers vuren ongeacht EXECUTE-recht.
REVOKE EXECUTE ON FUNCTION public.blokkeer_persoonsgebonden_document() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.normaliseer_naam(text) FROM PUBLIC, anon, authenticated;

COMMIT;
