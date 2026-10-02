-- 085: regressie-testset — kernfeiten als groepen met een minimum.
--
-- Oud: kernfeit text[] + alle boolean. Met alle=false slaagde een vraag zodra
-- één van meerdere VERSCHILLENDE feiten in het antwoord stond (bv. "Bernice of
-- Maike"), dus ook bij een onvolledig antwoord.
-- Nieuw: kernfeit_groepen jsonb = lijst van groepen; elke groep is één feit met
-- alleen schrijfvarianten van dat feit (bv. ["19:00","19.00"]). min_treffers =
-- hoeveel groepen gevonden moeten worden (NULL = alle groepen).
-- De oude kolommen worden in 086 verwijderd, ná de deploy van de runner die de
-- nieuwe kolommen leest.

ALTER TABLE public.regressie_vragen
  ADD COLUMN IF NOT EXISTS kernfeit_groepen jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS min_treffers integer CHECK (min_treffers IS NULL OR min_treffers >= 1);

ALTER TABLE public.regressie_vragen ALTER COLUMN kernfeit DROP NOT NULL;
ALTER TABLE public.regressie_vragen ALTER COLUMN alle DROP NOT NULL;
