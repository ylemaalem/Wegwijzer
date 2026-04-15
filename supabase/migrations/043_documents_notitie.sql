-- =============================================
-- WEGWIJZER — Migratie 043
-- Notitie-veld per document. Admin kan een korte instructie bij
-- het document zetten die de chatbot meekrijgt als "⚠️ Notitie van
-- de organisatie" naast de documentinhoud.
-- =============================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS notitie TEXT;
