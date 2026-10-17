-- 093: periodekeuze voor de trendanalyse (30 dagen, 3 maanden, 6 maanden, alles).
-- Bestaande rapporten gingen over de afgelopen 30 dagen.

ALTER TABLE public.trendanalyse_rapporten
  ADD COLUMN IF NOT EXISTS periode text NOT NULL DEFAULT '30d';

ALTER TABLE public.trendanalyse_rapporten
  DROP CONSTRAINT IF EXISTS trendanalyse_rapporten_periode_check;
ALTER TABLE public.trendanalyse_rapporten
  ADD CONSTRAINT trendanalyse_rapporten_periode_check CHECK (periode IN ('30d', '3m', '6m', 'alles'));
