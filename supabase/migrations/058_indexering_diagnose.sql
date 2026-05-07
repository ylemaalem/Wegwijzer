-- Foutdiagnose per document + gebruik-tracking
-- indexering_status bestaat al van 057 (IF NOT EXISTS is veilig)
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS indexering_status TEXT DEFAULT 'klaar',
  ADD COLUMN IF NOT EXISTS indexering_fout TEXT,
  ADD COLUMN IF NOT EXISTS indexering_voltooid_op TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aantal_chunks INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extractie_methode TEXT,
  ADD COLUMN IF NOT EXISTS gebruikt_count INT DEFAULT 0;
-- indexering_status waarden: 'klaar', 'bezig', 'fout', 'gescand_pdf'
-- extractie_methode waarden: 'pdf-text', 'docx', 'txt', 'html', 'overig'
