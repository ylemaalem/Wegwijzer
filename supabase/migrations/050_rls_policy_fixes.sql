-- =============================================
-- WEGWIJZER — Migratie 050
-- RLS policy opschoning op meerdere tabellen:
--   1. app_feedback — INSERT-policy voor authenticated medewerkers
--   2. meldingen    — medewerker_read_meldingen te breed: beperken
--                     tot teamleider + admin
--   3. rate_extensions — service_all_extensions te breed: droppen
--                         (medewerker heeft user_read_own_extensions,
--                          Edge Function draait als service_role en
--                          omzeilt RLS automatisch)
--   4. kennisnotities — policy herschrijven naar eenvoudige
--                       get_my_role() + get_my_tenant_id() vorm
--
-- Storage bucket limits (file_size_limit + allowed_mime_types op
-- bucket 'documents') staan NIET in deze migratie — apart via
-- Supabase dashboard / MCP zetten.
-- =============================================

-- =============================================
-- 1. app_feedback
-- =============================================
-- Medewerkers mogen feedback insturen (elke authenticated user binnen
-- eigen tenant — de check via auth.uid() voorkomt anon-inserts).
DROP POLICY IF EXISTS "medewerker_insert_feedback" ON public.app_feedback;
CREATE POLICY "medewerker_insert_feedback"
  ON public.app_feedback FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Admin mag feedback lezen van eigen tenant
DROP POLICY IF EXISTS "admin_read_feedback" ON public.app_feedback;
CREATE POLICY "admin_read_feedback"
  ON public.app_feedback FOR SELECT
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );

-- =============================================
-- 2. meldingen — beperken tot teamleider + admin
-- =============================================
DROP POLICY IF EXISTS "medewerker_read_meldingen"
  ON public.meldingen;

CREATE POLICY "medewerker_read_eigen_team_meldingen"
  ON public.meldingen FOR SELECT
  USING (
    tenant_id = public.get_my_tenant_id()
    AND (
      public.get_my_role() = 'teamleider'
      OR public.get_my_role() = 'admin'
    )
  );

-- =============================================
-- 3. rate_extensions — service_all_extensions droppen
-- =============================================
-- Was: FOR ALL USING (true) — veel te breed. Edge Function gebruikt
-- service_role via supabaseAdmin en omzeilt RLS sowieso. Medewerker
-- heeft al user_read_own_extensions + user_insert_own_extensions.
DROP POLICY IF EXISTS "service_all_extensions"
  ON public.rate_extensions;

-- =============================================
-- 4. kennisnotities — policy herschrijven
-- =============================================
DROP POLICY IF EXISTS "admin_crud_kennisnotities"
  ON public.kennisnotities;

CREATE POLICY "admin_crud_kennisnotities"
  ON public.kennisnotities FOR ALL
  USING (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND tenant_id = public.get_my_tenant_id()
  );
