-- =============================================
-- WEGWIJZER — Migratie 034
-- App feedback tabel: gebruikersfeedback over de app zelf
-- =============================================

CREATE TABLE IF NOT EXISTS public.app_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  medewerker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  functiegroep text,
  categorie text NOT NULL CHECK (categorie IN ('werkt_niet', 'verbetering', 'antwoord_klopt_niet', 'anders')),
  bericht text NOT NULL,
  status text NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw', 'gelezen', 'afgehandeld')),
  ingediend_op timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_tenant ON public.app_feedback(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_feedback_status ON public.app_feedback(status);

ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;

-- Medewerker mag eigen feedback insertten
CREATE POLICY "medewerker_insert_app_feedback"
  ON public.app_feedback FOR INSERT
  WITH CHECK (tenant_id = public.get_my_tenant_id());

-- Admin leest alle app feedback
CREATE POLICY "admin_read_app_feedback"
  ON public.app_feedback FOR SELECT
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

-- Admin kan status updaten en verwijderen
CREATE POLICY "admin_update_app_feedback"
  ON public.app_feedback FOR UPDATE
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());

CREATE POLICY "admin_delete_app_feedback"
  ON public.app_feedback FOR DELETE
  USING (public.get_my_role() = 'admin' AND tenant_id = public.get_my_tenant_id());
