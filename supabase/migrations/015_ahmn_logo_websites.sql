-- =============================================
-- WEGWIJZER — Migratie 015
-- AHMN logo URL instellen, toegestane websites tabel
-- =============================================

-- 1. AHMN logo URL instellen in settings
INSERT INTO public.settings (tenant_id, sleutel, waarde, updated_at)
SELECT t.id, 'logo_url', 'https://www.ambulantehulpverlening.nl/wp-content/themes/ambulantehulpverlening-2021/dist/images/favicon/favicon-196.png', now()
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings s WHERE s.tenant_id = t.id AND s.sleutel = 'logo_url'
)
LIMIT 1;

-- 2. Toegestane websites tabel (Probleem 9)
CREATE TABLE IF NOT EXISTS public.toegestane_websites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  naam text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.toegestane_websites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_crud_websites"
  ON public.toegestane_websites FOR ALL
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- Medewerker en teamleider mogen websites lezen (voor edge function)
CREATE POLICY "users_read_websites"
  ON public.toegestane_websites FOR SELECT
  USING (tenant_id = public.get_my_tenant_id());

CREATE INDEX IF NOT EXISTS idx_websites_tenant ON public.toegestane_websites(tenant_id);
