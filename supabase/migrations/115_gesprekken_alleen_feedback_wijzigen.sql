-- 115: gesprekken (conversations) — gebruikers wijzigen alleen hun beoordeling (audit B-04).
--
-- Was: medewerker en teamleider mochten eigen gesprekken invoegen en ALLE velden van
-- eigen gesprekken wijzigen (datum, vraag, antwoord, organisatie). Daarmee was de
-- daglimiet te omzeilen en konden gesprekken worden herschreven of verplaatst.
-- De app voegt nooit gesprekken in vanuit de browser (dat doet de chatfunctie met de
-- service-rol) en wijzigt alleen feedback/feedback_op (medewerker) en
-- feedback_afgehandeld_op (beheerder).
--
-- Nu:
-- - trigger bewaak_gesprekwijziging: via de publieke API mag een gebruiker alleen
--   feedback en feedback_op wijzigen; een beheerder van de eigen organisatie alles
--   behalve tenant_id en user_id. Service-rol (chatfunctie, verwijder-gebruiker),
--   postgres (cron) en SECURITY DEFINER-functies vallen erbuiten (zelfde opzet als
--   bewaak_profielwijziging op profiles).
-- - de twee invoegregels voor medewerker en teamleider vervallen.
--
-- Rechtentest: audit/audit_deel1_rechten.sql (niet in git; teruggedraaid blok).
--
-- TERUGDRAAIEN:
--   DROP TRIGGER IF EXISTS trg_conversations_bewaak ON public.conversations;
--   DROP FUNCTION IF EXISTS public.bewaak_gesprekwijziging();
--   CREATE POLICY medewerker_insert_conversations ON public.conversations FOR INSERT
--     WITH CHECK (user_id = get_my_profile_id() AND tenant_id = get_my_tenant_id());
--   CREATE POLICY teamleider_write_own_conversations ON public.conversations FOR INSERT
--     WITH CHECK (get_my_role() = 'teamleider' AND user_id = get_my_profile_id() AND tenant_id = get_my_tenant_id());

CREATE OR REPLACE FUNCTION public.bewaak_gesprekwijziging()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- Velden die de eigenaar van een gesprek zelf mag wijzigen (duimpje).
  vrij_te_wijzigen text[] := ARRAY['feedback', 'feedback_op'];
BEGIN
  -- Alleen verzoeken via de publieke API controleren.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF public.is_superadmin() THEN
    RETURN NEW;
  END IF;
  -- Beheerder van de eigen organisatie (verbeterpunt afhandelen): gesprek blijft bij
  -- dezelfde organisatie en dezelfde medewerker.
  IF public.get_my_role() = 'admin' AND OLD.tenant_id = public.get_my_tenant_id() THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'GESPREK_BEVEILIGD: organisatie of eigenaar van een gesprek kan niet gewijzigd worden'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - vrij_te_wijzigen) IS DISTINCT FROM (to_jsonb(OLD) - vrij_te_wijzigen) THEN
    RAISE EXCEPTION 'GESPREK_BEVEILIGD: alleen de beoordeling van een eigen gesprek kan gewijzigd worden'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger-functie: niemand hoeft hem rechtstreeks aan te roepen.
REVOKE EXECUTE ON FUNCTION public.bewaak_gesprekwijziging() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_conversations_bewaak ON public.conversations;
CREATE TRIGGER trg_conversations_bewaak
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.bewaak_gesprekwijziging();

DROP POLICY IF EXISTS medewerker_insert_conversations ON public.conversations;
DROP POLICY IF EXISTS teamleider_write_own_conversations ON public.conversations;
