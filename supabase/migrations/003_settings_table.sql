-- =============================================
-- Settings tabel voor tenant-specifieke instellingen
-- (o.a. disclaimer tekst)
-- =============================================

CREATE TABLE IF NOT EXISTS public.settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sleutel text NOT NULL,
  waarde text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, sleutel)
);

CREATE INDEX IF NOT EXISTS idx_settings_tenant_id ON public.settings(tenant_id);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Alleen admin kan settings lezen
CREATE POLICY "admin_read_settings"
  ON public.settings
  FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Medewerker kan disclaimer lezen
CREATE POLICY "medewerker_read_disclaimer"
  ON public.settings
  FOR SELECT
  USING (
    tenant_id = public.get_my_tenant_id()
    AND sleutel = 'disclaimer'
  );

-- Admin kan settings aanmaken
CREATE POLICY "admin_insert_settings"
  ON public.settings
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Admin kan settings bijwerken
CREATE POLICY "admin_update_settings"
  ON public.settings
  FOR UPDATE
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Standaard disclaimer instellen voor bestaande tenants
INSERT INTO public.settings (tenant_id, sleutel, waarde)
SELECT id, 'disclaimer', 'Deel geen persoonsgegevens of cliëntinformatie in deze chat.'
FROM public.tenants
ON CONFLICT (tenant_id, sleutel) DO NOTHING;
