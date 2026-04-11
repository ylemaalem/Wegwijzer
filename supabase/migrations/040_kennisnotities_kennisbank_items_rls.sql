-- =============================================
-- WEGWIJZER — Migratie 040
-- Spec-conforme RLS policies voor kennisnotities + kennisbank_items.
-- Vervangen door expliciete EXISTS-subquery met role+tenant check
-- en WITH CHECK clause zodat zowel SELECT, UPDATE, DELETE en INSERT
-- één centrale rule volgen.
-- =============================================

-- ---- kennisnotities ----
DROP POLICY IF EXISTS "admin_crud_kennisnotities" ON public.kennisnotities;
CREATE POLICY "admin_crud_kennisnotities"
  ON public.kennisnotities
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND role = 'admin'
        AND tenant_id = kennisnotities.tenant_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND role = 'admin'
        AND tenant_id = kennisnotities.tenant_id
    )
  );

-- ---- kennisbank_items ----
-- Oude policy heette admin_crud_kennisbank (zie migratie 008) — droppen
-- onder beide mogelijke namen voor compatibiliteit.
DROP POLICY IF EXISTS "admin_crud_kennisbank" ON public.kennisbank_items;
DROP POLICY IF EXISTS "admin_crud_kennisbank_items" ON public.kennisbank_items;
CREATE POLICY "admin_crud_kennisbank_items"
  ON public.kennisbank_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND role = 'admin'
        AND tenant_id = kennisbank_items.tenant_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND role = 'admin'
        AND tenant_id = kennisbank_items.tenant_id
    )
  );
