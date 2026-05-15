-- StudyTube cursussen cache per tenant
CREATE TABLE IF NOT EXISTS studytube_cursussen (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  studytube_course_id TEXT NOT NULL,
  naam TEXT NOT NULL,
  duur_minuten INTEGER,
  deeplink_url TEXT,
  trefwoorden TEXT[] NOT NULL DEFAULT '{}',
  laatst_gesynchroniseerd TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, studytube_course_id)
);

-- Index voor snelle tenant-lookups
CREATE INDEX IF NOT EXISTS idx_studytube_cursussen_tenant
  ON studytube_cursussen(tenant_id);

-- RLS inschakelen
ALTER TABLE studytube_cursussen ENABLE ROW LEVEL SECURITY;

-- SELECT: ingelogde gebruikers van de eigen tenant
CREATE POLICY "studytube_cursussen_select"
  ON studytube_cursussen
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE user_id = auth.uid()
    )
  );

-- INSERT/UPDATE/DELETE: alleen service_role (Edge Functions)
-- service_role bypasses RLS by default — geen aparte policy nodig.
