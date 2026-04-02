-- =============================================
-- FIX: Trigger voor automatisch profiel aanmaken
-- Plak dit in Supabase SQL Editor en klik Run
-- =============================================

-- Stap 1: Maak de AHMN tenant alvast aan (als die nog niet bestaat)
INSERT INTO public.tenants (naam)
SELECT 'AHMN'
WHERE NOT EXISTS (SELECT 1 FROM public.tenants WHERE naam = 'AHMN');

-- Stap 2: Drop bestaande trigger (als die er is)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Stap 3: Verwijder eventueel bestaande gebruikers zonder profiel
-- (de mislukte poging van eerder)
DELETE FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.profiles);

-- Stap 4: Herschrijf de trigger functie met betere foutafhandeling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _role text;
  _functiegroep text;
  _naam text;
BEGIN
  -- Haal metadata op (veilig, met fallbacks)
  _role := COALESCE(NEW.raw_user_meta_data->>'role', 'medewerker');
  _naam := COALESCE(NEW.raw_user_meta_data->>'naam', '');

  -- Functiegroep: alleen instellen als het een geldige waarde is
  IF NEW.raw_user_meta_data->>'functiegroep' IN (
    'ambulant_begeleider',
    'ambulant_persoonlijk_begeleider',
    'woonbegeleider',
    'persoonlijk_woonbegeleider'
  ) THEN
    _functiegroep := NEW.raw_user_meta_data->>'functiegroep';
  ELSE
    _functiegroep := NULL;
  END IF;

  -- Zoek tenant: gebruik metadata of pak de eerste bestaande tenant
  _tenant_id := (NEW.raw_user_meta_data->>'tenant_id')::uuid;

  IF _tenant_id IS NULL THEN
    SELECT id INTO _tenant_id FROM public.tenants LIMIT 1;
  END IF;

  -- Als er nog steeds geen tenant is, maak er één aan
  IF _tenant_id IS NULL THEN
    INSERT INTO public.tenants (naam)
    VALUES ('AHMN')
    RETURNING id INTO _tenant_id;
  END IF;

  -- Maak profiel aan
  INSERT INTO public.profiles (user_id, email, naam, role, functiegroep, tenant_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    _naam,
    _role,
    _functiegroep,
    _tenant_id
  );

  RETURN NEW;
END;
$$;

-- Stap 5: Maak de trigger opnieuw aan
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
