-- =============================================
-- WEGWIJZER — RLS Audit Script
-- =============================================
-- Herhaalbare beveiligingscheck op Row Level Security policies. Signaleert de
-- patronen die tot het CODE ROOD privacy-incident (juli 2026) hebben geleid.
--
-- Gebruik: draai dit hele script in de Supabase SQL editor of via de management API.
-- Elke sectie geeft een resultset met bevindingen. NUL rijen = schoon op dat patroon.
--
-- LET OP: dit is een heuristiek, geen bewijs. Elke bevinding vraagt om een
-- menselijke beoordeling van de kolomsemantiek (bevat user_id profiles.id of
-- auth.users.id?) voordat je wijzigt. Kolomsemantiek verschilt per tabel in dit schema.
-- =============================================

-- ---------------------------------------------------------------
-- CHECK 1 — Tenant-tabellen met SELECT/ALL policies zonder tenant-scoping
-- ---------------------------------------------------------------
-- Policies op tabellen mét tenant_id-kolom die geen tenant_id-check bevatten EN
-- niet al door een persoonlijke eigenaar-kolom (user_id/profile_id/auth.uid) zijn
-- afgebakend. Zulke policies lekken over tenant-grenzen zodra er een tweede klant is.
SELECT
  'CHECK1_geen_tenant_scoping' AS check_naam,
  pol.tablename,
  pol.policyname,
  pol.cmd,
  pol.qual
FROM pg_policies pol
WHERE pol.schemaname = 'public'
  AND pol.cmd IN ('SELECT', 'ALL')
  AND EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = pol.tablename AND c.column_name = 'tenant_id'
  )
  AND COALESCE(pol.qual, '') NOT LIKE '%tenant_id%'
  AND COALESCE(pol.qual, '') NOT LIKE '%is_superadmin%'
  AND COALESCE(pol.qual, '') NOT LIKE '%get_my_profile_id%'
  AND COALESCE(pol.qual, '') NOT LIKE '%auth.uid()%'
  AND COALESCE(pol.qual, '') NOT IN ('true', 'false')
ORDER BY pol.tablename, pol.policyname;

-- ---------------------------------------------------------------
-- CHECK 2 — Policies die auth.uid() vergelijken met een user_id-kolom
--            terwijl die kolom mogelijk profiles.id bevat (of andersom)
-- ---------------------------------------------------------------
-- Dit script kan de kolomsemantiek niet zelf bepalen; het lijst alle policies op
-- die auth.uid() gebruiken, zodat je per tabel handmatig kunt verifiëren of de
-- kolom auth.users.id dan wel profiles.id bevat. Vergelijk met de tabel hieronder:
--   conversations.user_id      = profiles.id      → gebruik get_my_profile_id()
--   quiz_resultaten.user_id    = auth.users.id    → gebruik auth.uid()
--   vertrouwens_scores.user_id = auth.users.id    → gebruik auth.uid()
--   weekstart_briefings.user_id= auth.users.id    → gebruik auth.uid()
--   response_cache.user_id     = auth.users.id    → gebruik auth.uid()
--   push_subscriptions.user_id = auth.users.id    → gebruik auth.uid()
--   profiles.user_id           = auth.users.id    → gebruik auth.uid()
SELECT
  'CHECK2_auth_uid_gebruik' AS check_naam,
  pol.tablename,
  pol.policyname,
  pol.cmd,
  pol.qual
FROM pg_policies pol
WHERE pol.schemaname = 'public'
  AND COALESCE(pol.qual, '') LIKE '%auth.uid()%'
ORDER BY pol.tablename, pol.policyname;

-- ---------------------------------------------------------------
-- CHECK 3 — Tabellen met RLS aan maar ZONDER enige SELECT- of ALL-policy
-- ---------------------------------------------------------------
-- Zulke tabellen zijn stil onleesbaar via de anon/authenticated client (of, als
-- er alleen INSERT-policies zijn, alleen schrijfbaar). Vaak een onbedoelde fout.
SELECT
  'CHECK3_rls_zonder_select_policy' AS check_naam,
  t.tablename
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE t.schemaname = 'public'
  AND c.relrowsecurity = true
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = t.tablename
      AND p.cmd IN ('SELECT', 'ALL')
  )
ORDER BY t.tablename;

-- ---------------------------------------------------------------
-- CHECK 4 — Tabellen met een user_id-kolom maar zonder eigenaar-policy
-- ---------------------------------------------------------------
-- Een user_id-kolom impliceert persoonsgebonden data. Zonder een policy die op
-- user_id (of profile_id) filtert, is er geen eigenaar-afscherming — de data is
-- dan alleen zo veilig als de overige policies (rol/tenant) toevallig zijn.
SELECT
  'CHECK4_user_id_zonder_eigenaar_policy' AS check_naam,
  col.table_name
FROM information_schema.columns col
JOIN pg_class c ON c.relname = col.table_name
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE col.table_schema = 'public'
  AND col.column_name = 'user_id'
  AND c.relrowsecurity = true
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = col.table_name
      AND (
        COALESCE(p.qual, '') LIKE '%user_id = auth.uid()%'
        OR COALESCE(p.qual, '') LIKE '%auth.uid() = user_id%'
        OR COALESCE(p.qual, '') LIKE '%user_id = get_my_profile_id()%'
      )
  )
ORDER BY col.table_name;
