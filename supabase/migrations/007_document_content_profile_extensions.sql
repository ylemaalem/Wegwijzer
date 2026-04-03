-- =============================================
-- WEGWIJZER — Migratie 007
-- Document content, profiel uitbreidingen, functiehistorie
-- =============================================

-- 1. Content kolom voor geëxtraheerde tekst uit documenten
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS content text;

-- 2. Werkuren en regio kolommen voor profielen
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS werkuren text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS regio text;

-- 3. Functiehistorie tabel (log van functiewijzigingen)
CREATE TABLE IF NOT EXISTS public.functie_historie (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vorige_functie text,
  nieuwe_functie text NOT NULL,
  gewijzigd_op timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_functie_historie_profile ON public.functie_historie(profile_id);

-- RLS voor functiehistorie
ALTER TABLE public.functie_historie ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_functie_historie"
  ON public.functie_historie
  FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND profile_id IN (SELECT id FROM public.profiles WHERE tenant_id = public.get_my_tenant_id())
  );

CREATE POLICY "admin_insert_functie_historie"
  ON public.functie_historie
  FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND profile_id IN (SELECT id FROM public.profiles WHERE tenant_id = public.get_my_tenant_id())
  );

-- 4. Admin mag documents updaten (voor content kolom vullen)
CREATE POLICY "admin_update_documents"
  ON public.documents
  FOR UPDATE
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );
