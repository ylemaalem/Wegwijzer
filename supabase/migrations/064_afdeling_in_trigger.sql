-- =============================================
-- FIX: handle_new_user trigger opslaat ook `afdeling` uit user_metadata
-- =============================================

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

  -- Maak profiel aan (inclusief afdeling uit user_metadata)
  INSERT INTO public.profiles (user_id, email, naam, role, functiegroep, tenant_id, afdeling)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    _naam,
    _role,
    _functiegroep,
    _tenant_id,
    NULLIF(TRIM(NEW.raw_user_meta_data->>'afdeling'), '')
  );

  RETURN NEW;
END;
$$;
