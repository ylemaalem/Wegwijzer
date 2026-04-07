-- =============================================
-- WEGWIJZER — Migratie 027
-- Document mappen tabel
-- =============================================

CREATE TABLE IF NOT EXISTS public.document_mappen (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  naam text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, naam)
);

ALTER TABLE public.document_mappen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_crud_mappen"
  ON public.document_mappen FOR ALL
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );
