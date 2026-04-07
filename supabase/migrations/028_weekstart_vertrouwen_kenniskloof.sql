-- =============================================
-- WEGWIJZER — Migratie 028
-- Weekstart briefings, vertrouwenscheck, kenniskloof, doc aanvragen, rolwissel
-- =============================================

-- Weekstart briefings
CREATE TABLE IF NOT EXISTS public.weekstart_briefings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  week_nummer integer NOT NULL,
  briefing_tekst text NOT NULL,
  gelezen boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.weekstart_briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_briefings" ON public.weekstart_briefings FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admin_read_briefings" ON public.weekstart_briefings FOR SELECT USING (public.get_my_role() = 'admin');

-- Vertrouwenscheck scores
CREATE TABLE IF NOT EXISTS public.vertrouwens_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  week_nummer integer NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  signaal_verstuurd boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, week_nummer)
);

ALTER TABLE public.vertrouwens_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_scores" ON public.vertrouwens_scores FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admin_read_scores" ON public.vertrouwens_scores FOR SELECT USING (public.get_my_role() = 'admin');

-- Kenniskloof meldingen
CREATE TABLE IF NOT EXISTS public.kenniskloof_meldingen (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  onderwerp text NOT NULL,
  aantal_vragen integer NOT NULL,
  status text DEFAULT 'nieuw',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.kenniskloof_meldingen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_crud_kenniskloof" ON public.kenniskloof_meldingen FOR ALL USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- Document aanvragen
CREATE TABLE IF NOT EXISTS public.document_aanvragen (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  vraag text NOT NULL,
  concept_document text,
  status text DEFAULT 'nieuw',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.document_aanvragen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own_doc_aanvragen" ON public.document_aanvragen FOR ALL USING (user_id = auth.uid());
CREATE POLICY "admin_crud_doc_aanvragen" ON public.document_aanvragen FOR ALL USING (public.get_my_role() = 'admin');

-- Rol-wissel velden
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vorige_functiegroep text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rolwissel_gezien boolean DEFAULT true;
