-- 092: StudyTube-cursus verbergen (instelling in Beheer → Instellingen → StudyTube).
--
-- Een verborgen cursus wordt nooit als training onder een antwoord getoond.
-- De synchronisatie (studytube-sync) respecteert de instelling: de upsert schrijft
-- alleen eigen kolommen (verborgen blijft dus staan), en verborgen cursussen
-- krijgen geen nieuwe embedding of beschrijving.

ALTER TABLE public.studytube_cursussen
  ADD COLUMN IF NOT EXISTS verborgen boolean NOT NULL DEFAULT false;

-- Zoeken: verborgen cursussen overslaan (verder gelijk aan de versie uit 068).
CREATE OR REPLACE FUNCTION public.match_studytube_cursussen(
  query_embedding vector,
  tenant_id_input uuid,
  match_threshold double precision DEFAULT 0.65,
  match_count integer DEFAULT 3
)
RETURNS TABLE(naam text, duur_minuten integer, deeplink_url text, similarity double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Verhoogde probes voor StudyTube (kleinere index met lists=10, probes=5 dekt
  -- de helft van de clusters).
  PERFORM set_config('ivfflat.probes', '5', true);

  RETURN QUERY
  SELECT
    sc.naam,
    sc.duur_minuten,
    sc.deeplink_url,
    1 - (sc.embedding <=> query_embedding) AS similarity
  FROM public.studytube_cursussen sc
  WHERE sc.tenant_id = tenant_id_input
    AND sc.embedding IS NOT NULL
    AND NOT sc.verborgen
    AND 1 - (sc.embedding <=> query_embedding) > match_threshold
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

-- Beheer: alleen een admin van de eigen organisatie (of de superadmin) zet een
-- cursus op verborgen of weer zichtbaar. Schrijven op de tabel zelf blijft
-- voorbehouden aan de service role.
CREATE OR REPLACE FUNCTION public.zet_studytube_cursus_verborgen(p_cursus_id uuid, p_verborgen boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.studytube_cursussen WHERE id = p_cursus_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Cursus niet gevonden' USING ERRCODE = 'P0002';
  END IF;
  -- COALESCE: zonder profiel geeft get_my_role() NULL, en NOT NULL zou de
  -- weigering overslaan.
  IF NOT COALESCE(public.is_superadmin() OR (public.get_my_role() = 'admin' AND public.get_my_tenant_id() = v_tenant), false) THEN
    RAISE EXCEPTION 'Alleen een beheerder kan cursussen verbergen' USING ERRCODE = '42501';
  END IF;
  UPDATE public.studytube_cursussen SET verborgen = p_verborgen WHERE id = p_cursus_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.zet_studytube_cursus_verborgen(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zet_studytube_cursus_verborgen(uuid, boolean) TO authenticated;
