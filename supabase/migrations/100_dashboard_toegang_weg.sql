-- profiles.dashboard_toegang (migratie 016) gaf vroeger dashboardtoegang zonder rij in
-- teamleiders. Sinds migratie 096 telt alleen nog een teamleiders-rij; de kolom werd
-- nergens meer gelezen of gezet en stond bij 0 profielen aan (gecontroleerd 2026-10-23).
ALTER TABLE public.profiles DROP COLUMN IF EXISTS dashboard_toegang;
