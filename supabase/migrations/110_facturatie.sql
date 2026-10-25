-- 110: facturatie per organisatie (opdracht F, keuzes Younes 2026-10-25).
-- - account_historie: per account periodes (rol, alleen_dashboard, type, einddatum,
--   aangemaakt_op, gestopt_op). Gevuld door triggers op profiles; blijft bestaan als het
--   account wordt verwijderd (geen verwijzing naar profiles of tenants).
-- - Een account telt vanaf de uitnodiging (profiel aangemaakt). Een kalendermaand
--   (Nederlandse tijd) telt elk account dat op minstens één dag actief was: aangemaakt vóór
--   het einde van de maand, niet gestopt vóór het begin, einddatum (ook bij vaste accounts)
--   niet vóór het begin. Telt mee: role 'medewerker', en role 'teamleider' zonder
--   alleen_dashboard (keuze 1: leidinggevenden met alleen het dashboard tellen niet).
--   De beheerder (admin) telt nooit mee.
-- - Te factureren = max(aantal, minimum 15); bedrag = te factureren x prijs per account
--   per maand: €19,50 (maandcontract) of €17,50 (jaarcontract), uit facturatie_tarief.
-- - Alleen de superadmin leest de historie en het overzicht. Het tarief van de eigen
--   organisatie is ook leesbaar voor de beheerder (de prijsschatting in Beheer).
-- - Bewaartermijnen: account_historie 24 maanden na gestopt_op; facturatie_maand 7 jaar.
-- - Geen GRANT aan anon (keuze 7).
-- Rechtentest: tests/sql/facturatie.sql

-- 1. Tabellen
CREATE TABLE IF NOT EXISTS public.account_historie (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  account_id uuid NOT NULL,
  user_id uuid,
  rol text NOT NULL,
  alleen_dashboard boolean NOT NULL DEFAULT false,
  type text,
  einddatum date,
  aangemaakt_op timestamptz NOT NULL,
  gestopt_op timestamptz,
  bron text NOT NULL DEFAULT 'trigger' CHECK (bron IN ('trigger', 'terugvulling')),
  CHECK (gestopt_op IS NULL OR gestopt_op >= aangemaakt_op)
);
CREATE INDEX IF NOT EXISTS account_historie_tenant_periode_idx ON public.account_historie (tenant_id, aangemaakt_op, gestopt_op);
CREATE UNIQUE INDEX IF NOT EXISTS account_historie_open_idx ON public.account_historie (account_id) WHERE gestopt_op IS NULL;

CREATE TABLE IF NOT EXISTS public.facturatie_tarief (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contract text NOT NULL CHECK (contract IN ('maand', 'jaar')),
  prijs_cent integer NOT NULL CHECK (prijs_cent > 0),
  minimum integer NOT NULL DEFAULT 15 CHECK (minimum >= 0),
  factureren boolean NOT NULL DEFAULT true,
  geldig_vanaf date NOT NULL DEFAULT current_date,
  aangemaakt_op timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, geldig_vanaf)
);

CREATE TABLE IF NOT EXISTS public.facturatie_maand (
  tenant_id uuid NOT NULL,
  maand date NOT NULL CHECK (extract(day FROM maand) = 1),
  aantal_actief integer NOT NULL,
  te_factureren integer NOT NULL,
  contract text NOT NULL,
  prijs_cent integer NOT NULL,
  bedrag_cent integer NOT NULL,
  vastgezet_op timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, maand)
);

ALTER TABLE public.account_historie ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturatie_tarief ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facturatie_maand ENABLE ROW LEVEL SECURITY;

-- Alleen lezen; schrijven gebeurt door triggers en functies (SECURITY DEFINER).
DROP POLICY IF EXISTS superadmin_lees_account_historie ON public.account_historie;
CREATE POLICY superadmin_lees_account_historie ON public.account_historie
  FOR SELECT TO authenticated USING ((SELECT public.is_superadmin()));
DROP POLICY IF EXISTS superadmin_lees_facturatie_maand ON public.facturatie_maand;
CREATE POLICY superadmin_lees_facturatie_maand ON public.facturatie_maand
  FOR SELECT TO authenticated USING ((SELECT public.is_superadmin()));
DROP POLICY IF EXISTS lees_facturatie_tarief ON public.facturatie_tarief;
CREATE POLICY lees_facturatie_tarief ON public.facturatie_tarief
  FOR SELECT TO authenticated
  USING ((SELECT public.is_superadmin())
         OR ((SELECT public.get_my_role()) = 'admin' AND tenant_id = (SELECT public.get_my_tenant_id())));
DROP POLICY IF EXISTS superadmin_beheer_facturatie_tarief ON public.facturatie_tarief;
CREATE POLICY superadmin_beheer_facturatie_tarief ON public.facturatie_tarief
  FOR ALL TO authenticated
  USING ((SELECT public.is_superadmin())) WITH CHECK ((SELECT public.is_superadmin()));

-- Geen anon (keuze 7); RLS bepaalt de rijen.
REVOKE ALL ON TABLE public.account_historie, public.facturatie_tarief, public.facturatie_maand FROM anon;
GRANT SELECT ON TABLE public.account_historie, public.facturatie_maand TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.facturatie_tarief TO authenticated;

-- 2. Logboek bijhouden vanuit profiles
CREATE OR REPLACE FUNCTION public.log_account_historie()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.account_historie (tenant_id, account_id, user_id, rol, alleen_dashboard, type, einddatum, aangemaakt_op)
    VALUES (NEW.tenant_id, NEW.id, NEW.user_id, NEW.role, NEW.alleen_dashboard, NEW.account_type, NEW.einddatum, now());
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE public.account_historie SET gestopt_op = now() WHERE account_id = OLD.id AND gestopt_op IS NULL;
    RETURN NULL;
  END IF;
  -- UPDATE: rol, type, organisatie of alleen_dashboard anders = nieuwe periode.
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.account_type IS DISTINCT FROM OLD.account_type
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.alleen_dashboard IS DISTINCT FROM OLD.alleen_dashboard THEN
    UPDATE public.account_historie SET gestopt_op = now() WHERE account_id = OLD.id AND gestopt_op IS NULL;
    INSERT INTO public.account_historie (tenant_id, account_id, user_id, rol, alleen_dashboard, type, einddatum, aangemaakt_op)
    VALUES (NEW.tenant_id, NEW.id, NEW.user_id, NEW.role, NEW.alleen_dashboard, NEW.account_type, NEW.einddatum, now());
  ELSIF NEW.einddatum IS DISTINCT FROM OLD.einddatum THEN
    UPDATE public.account_historie SET einddatum = NEW.einddatum WHERE account_id = NEW.id AND gestopt_op IS NULL;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.log_account_historie() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_account_historie ON public.profiles;
CREATE TRIGGER trg_account_historie
  AFTER INSERT OR DELETE OR UPDATE OF role, account_type, tenant_id, alleen_dashboard, einddatum ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.log_account_historie();

-- 3. Eenmalig vullen met de bestaande accounts (de 8 al verwijderde accounts niet:
--    rol, type en aanmaakdatum zijn onbekend).
INSERT INTO public.account_historie (tenant_id, account_id, user_id, rol, alleen_dashboard, type, einddatum, aangemaakt_op, bron)
SELECT p.tenant_id, p.id, p.user_id, p.role, p.alleen_dashboard, p.account_type, p.einddatum, p.created_at, 'terugvulling'
  FROM public.profiles p
 WHERE NOT EXISTS (SELECT 1 FROM public.account_historie h WHERE h.account_id = p.id);

-- 4. Maandoverzicht
CREATE OR REPLACE FUNCTION public.telt_voor_factuur(p_rol text, p_alleen_dashboard boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_rol = 'medewerker' OR (p_rol = 'teamleider' AND NOT COALESCE(p_alleen_dashboard, false));
$function$;

-- Berekening zonder rechtencontrole; alleen voor de functies hieronder.
CREATE OR REPLACE FUNCTION public.bereken_facturatie_maand(p_maand date)
 RETURNS TABLE (tenant_id uuid, organisatie text, maand date, aantal_actief integer, te_factureren integer,
                contract text, prijs_cent integer, bedrag_cent integer, factureren boolean, tarief_ingesteld boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH grenzen AS (
    SELECT date_trunc('month', p_maand)::date AS begin_dag,
           (date_trunc('month', p_maand) + interval '1 month')::date AS volgende_dag
  ), tijd AS (
    SELECT begin_dag, volgende_dag,
           (begin_dag::timestamp AT TIME ZONE 'Europe/Amsterdam') AS begin_ts,
           (volgende_dag::timestamp AT TIME ZONE 'Europe/Amsterdam') AS eind_ts
      FROM grenzen
  ), actief AS (
    SELECT h.tenant_id, count(DISTINCT h.account_id)::int AS aantal
      FROM public.account_historie h, tijd
     WHERE h.aangemaakt_op < tijd.eind_ts
       AND (h.gestopt_op IS NULL OR h.gestopt_op >= tijd.begin_ts)
       AND (h.einddatum IS NULL OR h.einddatum >= tijd.begin_dag)
       AND public.telt_voor_factuur(h.rol, h.alleen_dashboard)
     GROUP BY h.tenant_id
  ), tarief AS (
    SELECT DISTINCT ON (f.tenant_id) f.tenant_id, f.contract, f.prijs_cent, f.minimum, f.factureren
      FROM public.facturatie_tarief f, tijd
     WHERE f.geldig_vanaf < tijd.volgende_dag
     ORDER BY f.tenant_id, f.geldig_vanaf DESC
  )
  SELECT t.id, t.naam, (SELECT begin_dag FROM tijd),
         COALESCE(a.aantal, 0),
         GREATEST(COALESCE(a.aantal, 0), COALESCE(tf.minimum, 15)),
         COALESCE(tf.contract, 'maand'),
         COALESCE(tf.prijs_cent, 1950),
         GREATEST(COALESCE(a.aantal, 0), COALESCE(tf.minimum, 15)) * COALESCE(tf.prijs_cent, 1950),
         COALESCE(tf.factureren, true),
         tf.tenant_id IS NOT NULL
    FROM public.tenants t
    LEFT JOIN actief a ON a.tenant_id = t.id
    LEFT JOIN tarief tf ON tf.tenant_id = t.id
   ORDER BY t.naam;
$function$;
REVOKE EXECUTE ON FUNCTION public.bereken_facturatie_maand(date) FROM PUBLIC, anon, authenticated;

-- Voor het superadmin-scherm. Een vastgezette maand komt uit facturatie_maand.
CREATE OR REPLACE FUNCTION public.facturatie_maandoverzicht(p_maand date)
 RETURNS TABLE (tenant_id uuid, organisatie text, maand date, aantal_actief integer, te_factureren integer,
                contract text, prijs_cent integer, bedrag_cent integer, factureren boolean, tarief_ingesteld boolean,
                vastgezet boolean)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Alleen de superadmin kan het facturatie-overzicht zien' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT b.tenant_id, b.organisatie, b.maand,
         COALESCE(m.aantal_actief, b.aantal_actief), COALESCE(m.te_factureren, b.te_factureren),
         COALESCE(m.contract, b.contract), COALESCE(m.prijs_cent, b.prijs_cent), COALESCE(m.bedrag_cent, b.bedrag_cent),
         b.factureren, b.tarief_ingesteld, m.tenant_id IS NOT NULL
    FROM public.bereken_facturatie_maand(p_maand) b
    LEFT JOIN public.facturatie_maand m ON m.tenant_id = b.tenant_id AND m.maand = b.maand;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.facturatie_maandoverzicht(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturatie_maandoverzicht(date) TO authenticated;

-- 5. Maand vastzetten (op de 2e: de vorige maand) en bewaartermijnen
CREATE OR REPLACE FUNCTION public.zet_facturatie_maand_vast()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_maand date := (date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam') - interval '1 month')::date;
  v_aantal int;
BEGIN
  INSERT INTO public.facturatie_maand (tenant_id, maand, aantal_actief, te_factureren, contract, prijs_cent, bedrag_cent)
  SELECT b.tenant_id, b.maand, b.aantal_actief, b.te_factureren, b.contract, b.prijs_cent, b.bedrag_cent
    FROM public.bereken_facturatie_maand(v_maand) b
   WHERE b.factureren
  ON CONFLICT (tenant_id, maand) DO NOTHING;
  GET DIAGNOSTICS v_aantal = ROW_COUNT;
  -- Bewaartermijnen (keuze 6): account-id's 24 maanden, aantallen 7 jaar.
  DELETE FROM public.account_historie WHERE gestopt_op < now() - interval '24 months';
  DELETE FROM public.facturatie_maand WHERE maand < (now() - interval '7 years')::date;
  RETURN v_aantal;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.zet_facturatie_maand_vast() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facturatie-maand-vastzetten';
SELECT cron.schedule('facturatie-maand-vastzetten', '0 4 2 * *', 'SELECT public.zet_facturatie_maand_vast();');
