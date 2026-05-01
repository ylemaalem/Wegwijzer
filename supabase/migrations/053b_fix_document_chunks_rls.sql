-- Fix: document_chunks RLS policy gebruikte org_id van profiles,
-- maar profiles heeft tenant_id (niet org_id).
DROP POLICY IF EXISTS "chunks_select_own_org" ON public.document_chunks;

CREATE POLICY "chunks_select_own_org"
  ON public.document_chunks
  FOR SELECT
  USING (
    org_id = (
      SELECT tenant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1
    )
  );
