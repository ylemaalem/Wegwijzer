-- Voeg gebruikte_document_ids toe aan response_cache zodat bronvragen na
-- een cache-hit ook correct beantwoord kunnen worden.
ALTER TABLE public.response_cache
ADD COLUMN IF NOT EXISTS gebruikte_document_ids uuid[] DEFAULT '{}'::uuid[];
