-- HR-tabblad "Kennisbank" (2026-10-23): HR leest de kennisbank en reageert of doet
-- een voorstel; de beheerder handelt af in "Ter beoordeling".
-- Bestaande rechtenregels blijven ongewijzigd: HR krijgt GEEN leesrecht op documents,
-- kennisbank_items of kennisnotities. Het overzicht komt uit kennisbank_overzicht(),
-- dat alleen titels, mappen en datums van documenten teruggeeft (geen inhoud, geen
-- bestandspad, geen persoonlijke documenten van medewerkers).
-- Test: tests/sql/kennisbank_reacties.sql

-- 1. Reacties en voorstellen
CREATE TABLE public.kennisbank_reacties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ingediend_door uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- reactie op een regel: verouderd / moet_bijgewerkt / er_mist_iets / overig
  -- los: ontbrekend_document; voorstel: voorstel_kennisnotitie / voorstel_kennisbank_item
  soort text NOT NULL CHECK (soort IN ('verouderd', 'moet_bijgewerkt', 'er_mist_iets', 'overig',
                                        'ontbrekend_document', 'voorstel_kennisnotitie', 'voorstel_kennisbank_item')),
  verwijzing_type text CHECK (verwijzing_type IN ('document', 'kennisbank_item', 'kennisnotitie')),
  verwijzing_id uuid,
  verwijzing_naam text CHECK (char_length(verwijzing_naam) <= 300),
  -- voorstel kennisnotitie: onderwerp; voorstel kennisbank-item: de vraag
  onderwerp text CHECK (char_length(onderwerp) <= 500),
  tekst text NOT NULL CHECK (char_length(btrim(tekst)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw', 'overgenomen', 'afgehandeld', 'afgewezen')),
  antwoord_beheerder text CHECK (char_length(antwoord_beheerder) <= 2000),
  aangemaakt_op timestamptz NOT NULL DEFAULT now(),
  bijgewerkt_op timestamptz NOT NULL DEFAULT now(),
  afgehandeld_op timestamptz,
  afgehandeld_door uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CHECK ((verwijzing_type IS NULL) = (verwijzing_id IS NULL))
);
CREATE INDEX kennisbank_reacties_tenant_status_idx ON public.kennisbank_reacties (tenant_id, status, aangemaakt_op DESC);
CREATE INDEX kennisbank_reacties_ingediend_door_idx ON public.kennisbank_reacties (ingediend_door);
CREATE INDEX kennisbank_reacties_afgehandeld_door_idx ON public.kennisbank_reacties (afgehandeld_door);

CREATE OR REPLACE FUNCTION public.kennisbank_reacties_bijgewerkt()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.bijgewerkt_op := now();
  RETURN NEW;
END $$;
CREATE TRIGGER kennisbank_reacties_bijgewerkt BEFORE UPDATE ON public.kennisbank_reacties
  FOR EACH ROW EXECUTE FUNCTION public.kennisbank_reacties_bijgewerkt();

ALTER TABLE public.kennisbank_reacties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kennisbank_reacties FROM anon, public;
GRANT SELECT, INSERT, UPDATE ON public.kennisbank_reacties TO authenticated;

-- HR: alleen invoegen (op eigen naam, eigen organisatie, status nieuw) en eigen rijen lezen.
CREATE POLICY hr_insert_kennisbank_reacties ON public.kennisbank_reacties FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.mijn_leidinggevende_rol()) = 'hr'
              AND tenant_id = (SELECT public.get_my_tenant_id())
              AND ingediend_door = (SELECT public.get_my_profile_id())
              AND status = 'nieuw' AND antwoord_beheerder IS NULL
              AND afgehandeld_op IS NULL AND afgehandeld_door IS NULL);
CREATE POLICY hr_read_eigen_kennisbank_reacties ON public.kennisbank_reacties FOR SELECT TO authenticated
  USING ((SELECT public.mijn_leidinggevende_rol()) = 'hr'
         AND tenant_id = (SELECT public.get_my_tenant_id())
         AND ingediend_door = (SELECT public.get_my_profile_id()));
-- Beheerder: alles lezen en wijzigen binnen de eigen organisatie (niet verwijderen).
CREATE POLICY admin_read_kennisbank_reacties ON public.kennisbank_reacties FOR SELECT TO authenticated
  USING ((SELECT public.get_my_role()) = 'admin' AND tenant_id = (SELECT public.get_my_tenant_id()));
CREATE POLICY admin_update_kennisbank_reacties ON public.kennisbank_reacties FOR UPDATE TO authenticated
  USING ((SELECT public.get_my_role()) = 'admin' AND tenant_id = (SELECT public.get_my_tenant_id()))
  WITH CHECK ((SELECT public.get_my_role()) = 'admin' AND tenant_id = (SELECT public.get_my_tenant_id()));
CREATE POLICY superadmin_full ON public.kennisbank_reacties FOR ALL TO authenticated
  USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());

-- 2. Overzicht van de kennisbank voor HR en beheerder (alleen lezen).
CREATE OR REPLACE FUNCTION public.kennisbank_overzicht()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid := public.get_my_tenant_id();
BEGIN
  IF v_tenant IS NULL OR NOT (COALESCE(public.mijn_leidinggevende_rol() = 'hr', false) OR COALESCE(public.get_my_role() = 'admin', false)) THEN
    RAISE EXCEPTION 'Geen toegang' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'documenten', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', d.id, 'naam', d.naam, 'map', d.map, 'documenttype', d.documenttype,
               'aangemaakt_op', d.created_at, 'revisiedatum', d.revisiedatum,
               'uitgesloten_van_zoeken', COALESCE(d.uitgesloten_van_zoeken, false))
             ORDER BY d.map NULLS LAST, d.naam)
        FROM public.documents d
       WHERE d.tenant_id = v_tenant
         AND d.user_id IS NULL                       -- geen persoonlijke documenten
         AND NOT COALESCE(d.is_crawled_page, false)), '[]'::jsonb),
    'kennisbank_items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', k.id, 'vraag', k.vraag, 'antwoord', k.antwoord,
                                          'aangemaakt_op', k.created_at, 'bijgewerkt_op', k.updated_at)
             ORDER BY k.vraag)
        FROM public.kennisbank_items k WHERE k.tenant_id = v_tenant), '[]'::jsonb),
    'kennisnotities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'onderwerp', n.originele_vraag, 'notitie', n.notitie,
                                          'aangemaakt_op', n.created_at)
             ORDER BY n.created_at DESC)
        FROM public.kennisnotities n WHERE n.tenant_id = v_tenant AND n.actief), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.kennisbank_overzicht() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.kennisbank_overzicht() TO authenticated;
