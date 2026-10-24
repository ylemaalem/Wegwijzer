-- 107: vervolgvragen in de regressietestset (F2 stap 2, 2026-10-24).
-- De runner stuurt vorige_beurten mee als messages (browsergeheugen), zodat
-- vervolgvragen getest worden. trainingen_verwacht controleert de getoonde trainingen:
--   {"bevat": ["autis"]}            minstens één training met dit woord in de naam
--   {"niet": ["autis"], "geen": true} geen training met dit woord / helemaal geen
-- Alleen nieuwe, lege kolommen (nullable, geen standaardwaarde: alleen metadata);
-- geen nieuwe tabel en geen wijziging aan RLS of rechten.
ALTER TABLE public.regressie_vragen
  ADD COLUMN IF NOT EXISTS vorige_beurten jsonb,
  ADD COLUMN IF NOT EXISTS trainingen_verwacht jsonb;

COMMENT ON COLUMN public.regressie_vragen.vorige_beurten IS
  'Eerdere beurten voor een vervolgvraag: [{role, content, minuten_geleden}]. De runner stuurt ze mee als messages.';
COMMENT ON COLUMN public.regressie_vragen.trainingen_verwacht IS
  'Controle op de getoonde trainingen: {bevat: [woorden], niet: [woorden], geen: bool}.';
