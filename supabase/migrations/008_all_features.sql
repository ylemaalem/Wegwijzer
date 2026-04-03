-- =============================================
-- WEGWIJZER — Migratie 008
-- Alle nieuwe features: documentmetadata, teams,
-- teamleiders, tijdelijke accounts, persoonlijke docs,
-- verbeterpunten, meldingen
-- =============================================

-- 1. Document metadata uitbreiden (Opdracht 1)
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS documenttype text DEFAULT 'overig';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS versienummer text DEFAULT '1.0';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS revisiedatum date;

-- 2. Persoonlijke documenten per medewerker (Opdracht 10)
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;

-- 3. Tijdelijke accounts (Opdracht 7)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_type text DEFAULT 'vast' CHECK (account_type IN ('vast', 'tijdelijk'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS einddatum date;

-- 4. Teams koppeling aan profielen (Opdracht 11)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS teams text[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS teamleider_naam text;

-- 5. Teamleiders tabel (Opdracht 11 & 12)
CREATE TABLE IF NOT EXISTS public.teamleiders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  naam text NOT NULL,
  email text,
  telefoon text,
  teams text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.teamleiders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_teamleiders"
  ON public.teamleiders FOR SELECT
  USING (tenant_id = public.get_my_tenant_id());

CREATE POLICY "admin_insert_teamleiders"
  ON public.teamleiders FOR INSERT
  WITH CHECK (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "admin_update_teamleiders"
  ON public.teamleiders FOR UPDATE
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "admin_delete_teamleiders"
  ON public.teamleiders FOR DELETE
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- 6. Kennisbank items voor verbeterpunten (Opdracht 6)
CREATE TABLE IF NOT EXISTS public.kennisbank_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vraag text NOT NULL,
  antwoord text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.kennisbank_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_crud_kennisbank"
  ON public.kennisbank_items FOR ALL
  USING (tenant_id = public.get_my_tenant_id());

-- 7. Meldingen tabel (Opdracht 5 & 6)
CREATE TABLE IF NOT EXISTS public.meldingen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL,
  bericht text NOT NULL,
  gelezen boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meldingen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_meldingen"
  ON public.meldingen FOR SELECT
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "admin_update_meldingen"
  ON public.meldingen FOR UPDATE
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "service_insert_meldingen"
  ON public.meldingen FOR INSERT
  WITH CHECK (tenant_id = public.get_my_tenant_id());

-- Medewerker mag ook lezen (voor privacy melding check)
CREATE POLICY "medewerker_read_meldingen"
  ON public.meldingen FOR SELECT
  USING (tenant_id = public.get_my_tenant_id());

-- 8. Index voor persoonlijke documenten
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_teamleiders_tenant ON public.teamleiders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kennisbank_tenant ON public.kennisbank_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meldingen_tenant ON public.meldingen(tenant_id);
