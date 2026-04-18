-- =============================================
-- WEGWIJZER — Migratie 048
-- Onboarding checklist voor kennisbeheerder (HR).
-- Vaste set stappen per tenant; HR vinkt af.
-- =============================================

CREATE TABLE IF NOT EXISTS public.onboarding_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  stap_naam TEXT NOT NULL,
  afgerond BOOLEAN NOT NULL DEFAULT false,
  afgerond_op TIMESTAMPTZ,
  afgerond_door UUID REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_checklist_tenant
  ON public.onboarding_checklist (tenant_id);

ALTER TABLE public.onboarding_checklist
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_eigen_checklist"
  ON public.onboarding_checklist FOR ALL
  USING (
    get_my_role() = 'teamleider'
    AND tenant_id = get_my_tenant_id()
  );

CREATE POLICY "admin_read_checklist"
  ON public.onboarding_checklist FOR SELECT
  USING (tenant_id = get_my_tenant_id());

-- Superadmin moet checklists over alle tenants kunnen lezen.
DROP POLICY IF EXISTS "superadmin_full" ON public.onboarding_checklist;
CREATE POLICY "superadmin_full" ON public.onboarding_checklist
  FOR ALL
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- =============================================
-- Vaste stappen + seed voor bestaande tenants
-- =============================================
CREATE OR REPLACE FUNCTION public.seed_onboarding_checklist(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stap TEXT;
  stappen TEXT[] := ARRAY[
    'Organogram aangeleverd (als tekst, niet afbeelding)',
    'Agressieprotocol aangeleverd',
    'Personeelshandboek of arbeidsreglement aangeleverd',
    'Functieomschrijvingen aangeleverd',
    'CAO of arbeidsvoorwaarden aangeleverd',
    'Inwerkschema per functie aangeleverd',
    'Handleiding registratiesysteem aangeleverd',
    'Kennisitems aangemaakt voor veelgestelde vragen',
    'Testgesprek chatbot gedaan (minimaal 10 vragen)'
  ];
BEGIN
  FOREACH stap IN ARRAY stappen LOOP
    INSERT INTO public.onboarding_checklist (tenant_id, stap_naam)
    SELECT p_tenant_id, stap
    WHERE NOT EXISTS (
      SELECT 1 FROM public.onboarding_checklist
      WHERE tenant_id = p_tenant_id AND stap_naam = stap
    );
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_onboarding_checklist(UUID) TO authenticated;

-- Seed voor alle bestaande tenants
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_onboarding_checklist(t.id);
  END LOOP;
END $$;

-- Trigger: automatisch seeden bij nieuwe tenant
CREATE OR REPLACE FUNCTION public.trigger_seed_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_onboarding_checklist(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_onboarding_on_tenant_insert ON public.tenants;
CREATE TRIGGER seed_onboarding_on_tenant_insert
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_seed_onboarding();
