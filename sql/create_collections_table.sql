-- Create collections table for better performance
CREATE TABLE IF NOT EXISTS public.collections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  db_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  table_count INTEGER DEFAULT 0,
  total_embeddings INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_collections_db_id ON public.collections(db_id);
CREATE INDEX IF NOT EXISTS idx_collections_created_at ON public.collections(created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_collections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_collections_updated_at ON public.collections;
CREATE TRIGGER trigger_update_collections_updated_at
  BEFORE UPDATE ON public.collections
  FOR EACH ROW
  EXECUTE FUNCTION update_collections_updated_at();

-- Initial population of collections table
INSERT INTO public.collections (db_id, name, description, table_count, total_embeddings)
SELECT 
  db_id,
  db_id as name, -- Use db_id as name initially
  'Collection: ' || db_id as description,
  COUNT(DISTINCT table_name) as table_count,
  COUNT(*) as total_embeddings
FROM public.table_embeddings
GROUP BY db_id
ON CONFLICT (db_id) DO UPDATE SET
  table_count = EXCLUDED.table_count,
  total_embeddings = EXCLUDED.total_embeddings,
  updated_at = NOW();

-- Create function to refresh collection stats
CREATE OR REPLACE FUNCTION refresh_collection_stats()
RETURNS void AS $$
BEGIN
  INSERT INTO public.collections (db_id, name, description, table_count, total_embeddings)
  SELECT 
    db_id,
    db_id as name,
    'Collection: ' || db_id as description,
    COUNT(DISTINCT table_name) as table_count,
    COUNT(*) as total_embeddings
  FROM public.table_embeddings
  GROUP BY db_id
  ON CONFLICT (db_id) DO UPDATE SET
    table_count = EXCLUDED.table_count,
    total_embeddings = EXCLUDED.total_embeddings,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql; 