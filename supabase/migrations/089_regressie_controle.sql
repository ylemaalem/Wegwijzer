-- 089: regressievragen met een aparte controle naast de kernfeiten.
-- controle 'trainingen': de vraag is fout als de antwoordtekst zegt dat er geen
-- training is terwijl er trainingen onder het antwoord staan of aan het model zijn
-- meegegeven, of als de tekst naar trainingen "hieronder" verwijst terwijl er
-- geen staan. Zonder kernfeiten telt alleen deze controle.
ALTER TABLE public.regressie_vragen
  ADD COLUMN IF NOT EXISTS controle text
  CHECK (controle IS NULL OR controle IN ('trainingen'));
