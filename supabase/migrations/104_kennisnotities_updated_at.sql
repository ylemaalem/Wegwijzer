-- Datum van laatste wijziging voor kennisnotities (punt 4, 2026-10-23), zoals
-- kennisbank_items.updated_at al had. Bestaande notities: aanmaakdatum.
-- Beheer toont de datum en een lijst "ouder dan 6 maanden" (alleen bekijken).
-- Rechten ongewijzigd. Test: tests/sql/kennisnotities_updated_at.sql

ALTER TABLE public.kennisnotities ADD COLUMN updated_at timestamptz;
UPDATE public.kennisnotities SET updated_at = COALESCE(created_at, now());
ALTER TABLE public.kennisnotities ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.kennisnotities ALTER COLUMN updated_at SET NOT NULL;

-- Zelfde triggerfunctie als kennisbank_items.
CREATE TRIGGER kennisnotities_updated_at BEFORE UPDATE ON public.kennisnotities
  FOR EACH ROW EXECUTE FUNCTION public.update_kennisbank_updated_at();
