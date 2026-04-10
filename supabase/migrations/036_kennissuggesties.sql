-- =============================================
-- WEGWIJZER — Migratie 036
-- Kennissuggesties tabel: proactieve scan resultaten
-- =============================================

CREATE TABLE IF NOT EXISTS public.kennissuggesties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('conflict', 'hiaat', 'suggestie')),
  omschrijving text NOT NULL,
  document_a text,
  document_b text,
  status text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw', 'opgepakt', 'niet_relevant')),
  scan_type text NOT NULL DEFAULT 'snel' CHECK (scan_type IN ('snel', 'grondig')),
  notitie text,
  aangemaakt_op timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kennissuggesties_tenant ON public.kennissuggesties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kennissuggesties_status ON public.kennissuggesties(status);

ALTER TABLE public.kennissuggesties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_crud_kennissuggesties"
  ON public.kennissuggesties FOR ALL
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());
