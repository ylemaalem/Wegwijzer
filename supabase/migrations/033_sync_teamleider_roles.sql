-- =============================================
-- WEGWIJZER — Migratie 033
-- Sync: teamleiders tabel rol → profiles.role
-- Alle leidinggevenden (teamleider/manager/hr) krijgen
-- role='teamleider' in profiles zodat ze het dashboard zien.
-- =============================================

-- Eenmalige fix: update profiles.role naar 'teamleider' voor
-- iedereen die in de teamleiders tabel staat
UPDATE public.profiles p
SET role = 'teamleider'
FROM public.teamleiders t
WHERE p.email = t.email
AND p.tenant_id = t.tenant_id
AND p.role != 'admin';
