-- =============================================
-- WEGWIJZER — Migratie 037
-- Vertrouwenscheck + quiz: teamleider RLS + backfill gedeeld
-- =============================================

-- 1. Backfill: bestaande rijen waarbij signaal_verstuurd=true → gedeeld=true
--    Dit zorgt ervoor dat oude data correct migreert naar het nieuwe model.
UPDATE public.vertrouwens_scores
   SET gedeeld = true
 WHERE signaal_verstuurd = true
   AND (gedeeld IS NULL OR gedeeld = false);

-- 2. Teamleider mag gedeelde vertrouwenscheck-scores van eigen tenant lezen.
--    Niet-gedeelde scores blijven onzichtbaar voor de teamleider.
DROP POLICY IF EXISTS "teamleider_read_gedeelde_scores" ON public.vertrouwens_scores;
CREATE POLICY "teamleider_read_gedeelde_scores"
  ON public.vertrouwens_scores FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND gedeeld = true
    AND tenant_id = public.get_my_tenant_id()
  );

-- 3. Teamleider mag gedeelde quiz-resultaten van eigen tenant lezen.
DROP POLICY IF EXISTS "teamleider_read_gedeelde_quiz" ON public.quiz_resultaten;
CREATE POLICY "teamleider_read_gedeelde_quiz"
  ON public.quiz_resultaten FOR SELECT
  USING (
    public.get_my_role() = 'teamleider'
    AND gedeeld = true
    AND tenant_id = public.get_my_tenant_id()
  );
