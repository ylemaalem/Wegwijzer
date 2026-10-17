-- 090: regressievragen met verboden zinnen. Komt een van deze zinnen (kleine
-- letters, als tekstdeel) in het antwoord voor, dan is de vraag fout, ook als
-- de kernfeiten gevonden zijn. Bijvoorbeeld een correctie van de vraagsteller
-- ("FWG 40, niet FWG 35") terwijl die zelf naar FWG 35 vroeg.
ALTER TABLE public.regressie_vragen
  ADD COLUMN IF NOT EXISTS verboden jsonb;
