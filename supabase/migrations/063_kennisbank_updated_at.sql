ALTER TABLE kennisbank_items
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE kennisbank_items SET updated_at = created_at WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION update_kennisbank_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kennisbank_updated_at ON kennisbank_items;
CREATE TRIGGER kennisbank_updated_at
BEFORE UPDATE ON kennisbank_items
FOR EACH ROW EXECUTE FUNCTION update_kennisbank_updated_at();
