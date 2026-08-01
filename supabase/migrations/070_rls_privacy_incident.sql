-- =============================================
-- WEGWIJZER — Migratie 070 — CODE ROOD: RLS privacy-incident
-- =============================================
-- Aanleiding: een teamleider zag via de kennisassistent de chatgeschiedenis van
-- teamleden. Rootcause: de policy teamleider_lees_conversations gaf directe
-- rijtoegang tot teamleden-gesprekken, en een ongefilterde frontend-query toonde die.
--
-- Deze migratie:
--  P0  verwijdert de directe teamleider-rijtoegang tot conversations (dashboard
--      draait voortaan via de Edge Function met service role + anonimisering).
--  P1  corrigeert systematische auth.uid()-vs-profiles.id verwarring en ontbrekende
--      tenant-/rolchecks in andere policies.
--
-- Alle wijzigingen VERSMALLEN toegang of laten die gelijk; geen enkele verbreedt.
-- Kolomsemantiek is per tabel GEMETEN (niet aangenomen) — zie inline comments.
-- =============================================

BEGIN;

-- ============================================================
-- P0 — conversations: directe teamleider-toegang tot teamleden dichten
-- ============================================================
-- De teamleider behoudt toegang tot EIGEN gesprekken via
-- medewerker_read_own_conversations (USING user_id = get_my_profile_id()),
-- die rol-onafhankelijk voor iedere ingelogde gebruiker geldt.
-- Teamleden-gesprekken lopen voortaan uitsluitend via de Edge Function
-- (get_team_gesprek_metadata / generate_trendanalyse, service role, geanonimiseerd).
DROP POLICY IF EXISTS teamleider_lees_conversations ON public.conversations;

-- ============================================================
-- P1a — fgl_diagnostics: kapotte policy (p.id = auth.uid()) vervangen
-- ============================================================
-- profiles.id is NOOIT gelijk aan auth.uid() (profiles.user_id bevat auth.uid()).
-- p.id = auth.uid() matcht dus nooit → policy was stil dood. De tabel bevat
-- vraagtekst en dient puur retrieval-diagnostiek → beperken tot admin binnen tenant.
DROP POLICY IF EXISTS fgl_diag_teamleider_read ON public.fgl_diagnostics;
DROP POLICY IF EXISTS fgl_diag_admin_read ON public.fgl_diagnostics;
CREATE POLICY fgl_diag_admin_read ON public.fgl_diagnostics
  FOR SELECT
  USING (get_my_role() = 'admin' AND tenant_id = get_my_tenant_id());

-- ============================================================
-- P1b — quiz_resultaten: dode policy verwijderen
-- ============================================================
-- GEMETEN: quiz_resultaten.user_id bevat auth.uid() (3/3 rijen; insert schrijft
-- user_id: user.id). Dus user_own_quiz (user_id = auth.uid()) is de CORRECTE en
-- eigen_quiz (user_id = get_my_profile_id()) matcht nooit → verwijderen.
-- LET OP: dit is omgekeerd aan de oorspronkelijke incident-aanname; op data geverifieerd.
DROP POLICY IF EXISTS eigen_quiz ON public.quiz_resultaten;

-- ============================================================
-- P1c — vertrouwens_scores: dode policy + ontbrekende rolcheck
-- ============================================================
-- GEMETEN: user_id bevat auth.uid() (15/15). eigen_scores (get_my_profile_id) dood → weg.
DROP POLICY IF EXISTS eigen_scores ON public.vertrouwens_scores;
-- teamleider_read_gedeelde_scores miste de rolcheck: elke medewerker in de tenant
-- kon gedeelde vertrouwensscores van collega's lezen. Rolcheck toevoegen.
DROP POLICY IF EXISTS teamleider_read_gedeelde_scores ON public.vertrouwens_scores;
CREATE POLICY teamleider_read_gedeelde_scores ON public.vertrouwens_scores
  FOR SELECT
  USING (get_my_role() = 'teamleider' AND gedeeld = true AND tenant_id = get_my_tenant_id());

-- ============================================================
-- P1d — weekstart_briefings: ontbrekende tenant-scoping op admin-policy
-- ============================================================
-- Tabel heeft GEEN tenant_id-kolom; user_id bevat auth.uid(). admin_read_briefings
-- had alleen get_my_role()='admin' → een admin zou bij een tweede tenant briefings
-- van een andere organisatie kunnen lezen. Scope via join op profiles (user_id → tenant).
DROP POLICY IF EXISTS admin_read_briefings ON public.weekstart_briefings;
CREATE POLICY admin_read_briefings ON public.weekstart_briefings
  FOR SELECT
  USING (
    get_my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = weekstart_briefings.user_id
        AND p.tenant_id = get_my_tenant_id()
    )
  );

-- ============================================================
-- P1e — document_aanvragen: ontbrekende tenant-check op admin-policy
-- ============================================================
-- admin_crud_doc_aanvragen had alleen get_my_role()='admin' zonder tenant_id-check
-- → multi-tenant lek bij tweede klant. Tabel heeft wel tenant_id-kolom.
DROP POLICY IF EXISTS admin_crud_doc_aanvragen ON public.document_aanvragen;
CREATE POLICY admin_crud_doc_aanvragen ON public.document_aanvragen
  FOR ALL
  USING (get_my_role() = 'admin' AND tenant_id = get_my_tenant_id())
  WITH CHECK (get_my_role() = 'admin' AND tenant_id = get_my_tenant_id());

-- ============================================================
-- P1f — meldingen: verwarrend genoemde, redundante policy verwijderen
-- ============================================================
-- medewerker_read_eigen_team_meldingen geeft feitelijk teamleider/admin tenant-brede
-- toegang (naam suggereert medewerker-team-scope). De toegang wordt al correct gedekt
-- door teamleider_read_meldingen en admin_read_meldingen. Verwijderen voorkomt verwarring
-- zonder functionaliteit te verliezen.
DROP POLICY IF EXISTS medewerker_read_eigen_team_meldingen ON public.meldingen;

COMMIT;
