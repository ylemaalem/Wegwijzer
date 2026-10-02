-- 086: oude kernfeit-kolommen verwijderen (na deploy van de runner die
-- kernfeit_groepen + min_treffers leest, zie 085).
ALTER TABLE public.regressie_vragen DROP COLUMN IF EXISTS kernfeit;
ALTER TABLE public.regressie_vragen DROP COLUMN IF EXISTS alle;
