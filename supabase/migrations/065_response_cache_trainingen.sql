-- Voeg trainingen kolom toe aan response_cache voor consistente cache-hits
ALTER TABLE response_cache
ADD COLUMN IF NOT EXISTS trainingen jsonb DEFAULT NULL;
