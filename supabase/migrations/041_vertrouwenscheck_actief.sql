-- =============================================
-- WEGWIJZER — Migratie 041
-- vertrouwenscheck_actief flag op profiles zodat de wekelijkse
-- vertrouwenscheck na week 6 doorloopt tenzij medewerker zelf stopt.
-- =============================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vertrouwenscheck_actief BOOLEAN DEFAULT true;
