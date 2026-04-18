-- =============================================
-- WEGWIJZER — Migratie 046
-- Tabel document_aanvragen_beheer: teamleider/hr kan
-- documenten ter beoordeling indienen bij admin.
-- =============================================

CREATE TABLE IF NOT EXISTS public.document_aanvragen_beheer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  ingediend_door UUID NOT NULL REFERENCES public.profiles(id),
  bestandsnaam TEXT NOT NULL,
  bestandspad TEXT NOT NULL,
  toelichting TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_afwachting',
  aangemaakt_op TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.document_aanvragen_beheer
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teamleider_eigen_aanvragen"
  ON public.document_aanvragen_beheer FOR SELECT
  USING (
    get_my_role() = 'teamleider'
    AND ingediend_door = get_my_profile_id()
  );

CREATE POLICY "teamleider_insert_aanvraag"
  ON public.document_aanvragen_beheer FOR INSERT
  WITH CHECK (
    get_my_role() = 'teamleider'
    AND tenant_id = get_my_tenant_id()
  );

CREATE POLICY "admin_read_aanvragen"
  ON public.document_aanvragen_beheer FOR SELECT
  USING (
    get_my_role() = 'admin'
    AND tenant_id = get_my_tenant_id()
  );

CREATE POLICY "admin_update_aanvragen"
  ON public.document_aanvragen_beheer FOR UPDATE
  USING (
    get_my_role() = 'admin'
    AND tenant_id = get_my_tenant_id()
  );

CREATE POLICY "admin_delete_aanvragen"
  ON public.document_aanvragen_beheer FOR DELETE
  USING (
    get_my_role() = 'admin'
    AND tenant_id = get_my_tenant_id()
  );

-- Storage policies: teamleider mag bestanden uploaden naar de
-- documents bucket onder pad <tenant_id>/aanvragen/... en zijn
-- eigen aanvraag-bestanden lezen. Admin read/delete is al gedekt
-- door bestaande policies in 001_initial_schema.sql.
CREATE POLICY "teamleider_upload_aanvraag_bestand"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND public.get_my_role() = 'teamleider'
    AND (storage.foldername(name))[2] = 'aanvragen'
  );

CREATE POLICY "teamleider_lees_aanvraag_bestand"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND public.get_my_role() = 'teamleider'
    AND (storage.foldername(name))[2] = 'aanvragen'
  );
