-- De regressierun draait in delen (chat: regressie_run + regressie_deel). Een run is
-- pas compleet als klaar = true; volgende_index = de eerste vraag die nog moet.
-- Bestaande runs zijn compleet.
ALTER TABLE public.regressie_runs
  ADD COLUMN IF NOT EXISTS klaar boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS volgende_index integer;
