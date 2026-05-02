-- Fix: profiles.id ≠ auth.uid() — het juiste veld is user_id
DROP POLICY IF EXISTS "chunks_select_own_org" ON public.document_chunks;

CREATE POLICY "chunks_select_own_org"
  ON public.document_chunks
  FOR SELECT
  USING (
    org_id = (
      SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
    )
  );
