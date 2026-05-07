-- Herindexeringsstatus per document: 'klaar', 'bezig', 'fout'
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS indexering_status TEXT DEFAULT 'klaar';

-- Bijhouden welke documenten gebruikt werden bij een chatantwoord
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS gebruikte_document_ids UUID[] DEFAULT '{}';

-- Feedback-tellers en kwaliteitsscore per document
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS feedback_positief INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feedback_negatief INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kwaliteitsscore FLOAT DEFAULT NULL;
