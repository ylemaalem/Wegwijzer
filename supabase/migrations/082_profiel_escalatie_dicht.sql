-- 082: profielwijzigingen afschermen (rol-escalatie dicht).
--
-- Probleem (gemeten 2026-09-30, met rollback): policy eigen_profiel is
-- FOR ALL USING (user_id = auth.uid()) zonder kolombeperking. Een medewerker
-- kon daardoor via de publieke API elk veld van het eigen profiel wijzigen,
-- ook role → 'admin'. is_superadmin() keek naar role='admin' + naam
-- 'Wegwijzer Beheer', dus met die naam werd je zelfs superadmin over alle
-- organisaties. Dezelfde policy liet ook een INSERT van een eigen profiel toe.
--
-- Oplossing:
-- A) Superadmin hangt aan het account (tabel superadmins), niet aan een naam.
-- B) Trigger op profiles: via de API (rollen authenticated/anon) mag
--    - een niet-admin alleen vertrouwenscheck_actief en rolwissel_gezien van
--      het eigen profiel wijzigen (de enige twee die medewerker.js wijzigt);
--    - een admin profielen in de eigen organisatie wijzigen, maar niet het
--      gekoppelde account (user_id) of de organisatie (tenant_id);
--    - niemand behalve de superadmin een profiel aanmaken (profielen ontstaan
--      via handle_new_user bij een uitnodiging).
--    Edge Functions (service_role), handle_new_user en andere
--    SECURITY DEFINER-functies vallen buiten deze controle.

-- ============ A. Superadmin aan het account koppelen ============
CREATE TABLE IF NOT EXISTS public.superadmins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  toegevoegd_op timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.superadmins ENABLE ROW LEVEL SECURITY;
-- Geen policies en geen grants: alleen leesbaar via is_superadmin() (SECURITY DEFINER).
REVOKE ALL ON TABLE public.superadmins FROM anon, authenticated, PUBLIC;

-- Het bestaande beheeraccount ("Wegwijzer Beheer").
INSERT INTO public.superadmins (user_id)
SELECT user_id FROM public.profiles
WHERE naam = 'Wegwijzer Beheer' AND role = 'admin'
  AND user_id = 'b30551c0-8f10-4561-be9f-876b7f76ad2c'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.superadmins s
    JOIN public.profiles p ON p.user_id = s.user_id
    WHERE s.user_id = auth.uid()
      AND p.role = 'admin'
  );
$function$;

-- ============ B. Profielwijzigingen bewaken ============
CREATE OR REPLACE FUNCTION public.bewaak_profielwijziging()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Velden die een gebruiker zonder adminrol aan het eigen profiel mag wijzigen.
  vrij_te_wijzigen text[] := ARRAY['vertrouwenscheck_actief', 'rolwissel_gezien'];
BEGIN
  -- Alleen verzoeken via de publieke API controleren. service_role (Edge
  -- Functions), postgres en SECURITY DEFINER-functies vallen hierbuiten.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF is_superadmin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'PROFIEL_BEVEILIGD: profielen worden alleen via een uitnodiging aangemaakt'
      USING ERRCODE = '42501';
  END IF;

  -- UPDATE. get_my_role() leest de rol zoals die vóór deze wijziging was.
  IF get_my_role() = 'admin' AND OLD.tenant_id = get_my_tenant_id() THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'PROFIEL_BEVEILIGD: account of organisatie van een profiel kan niet gewijzigd worden'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - vrij_te_wijzigen) IS DISTINCT FROM (to_jsonb(OLD) - vrij_te_wijzigen) THEN
    RAISE EXCEPTION 'PROFIEL_BEVEILIGD: alleen een beheerder kan deze profielgegevens wijzigen'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bewaak_profielwijziging() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bewaak_profielwijziging ON public.profiles;
CREATE TRIGGER trg_bewaak_profielwijziging
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.bewaak_profielwijziging();
