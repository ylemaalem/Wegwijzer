-- =============================================
-- WEGWIJZER — Migratie 029
-- Kennisnotities, quiz resultaten, terugblik log
-- =============================================

-- Kennisnotities
CREATE TABLE IF NOT EXISTS public.kennisnotities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  originele_vraag text NOT NULL,
  notitie text NOT NULL,
  aangemaakt_door uuid,
  actief boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.kennisnotities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_crud_kennisnotities" ON public.kennisnotities FOR ALL
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- Quiz resultaten
CREATE TABLE IF NOT EXISTS public.quiz_resultaten (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  week_nummer integer NOT NULL,
  score integer NOT NULL,
  totaal integer DEFAULT 3,
  gedeeld boolean DEFAULT false,
  onderwerpen text[],
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, week_nummer)
);

ALTER TABLE public.quiz_resultaten ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_quiz" ON public.quiz_resultaten FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admin_read_quiz" ON public.quiz_resultaten FOR SELECT
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- Terugblik log
CREATE TABLE IF NOT EXISTS public.terugblik_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  maand text NOT NULL,
  verstuurd_op timestamptz DEFAULT now(),
  aantal_ontvangers integer DEFAULT 0,
  status text DEFAULT 'verstuurd',
  foutmelding text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.terugblik_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_crud_terugblik" ON public.terugblik_log FOR ALL
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- Vertrouwenscheck scores aanpassen: voeg gedeeld kolom toe als die niet bestaat
ALTER TABLE public.vertrouwens_scores ADD COLUMN IF NOT EXISTS gedeeld boolean DEFAULT false;
ALTER TABLE public.vertrouwens_scores ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id);
