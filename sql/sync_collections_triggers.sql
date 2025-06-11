-- Function to update collection stats when table_embeddings changes
CREATE OR REPLACE FUNCTION sync_collections_on_embedding_change()
RETURNS trigger AS $$
DECLARE
  affected_db_id text;
BEGIN
  -- Get the affected db_id from either NEW or OLD record
  IF TG_OP = 'DELETE' THEN
    affected_db_id := OLD.db_id;
  ELSE
    affected_db_id := NEW.db_id;
  END IF;

  -- Update the collection stats for the affected db_id
  INSERT INTO public.collections (db_id, name, description, table_count, total_embeddings)
  SELECT 
    te.db_id,
    te.db_id as name,
    'Collection: ' || te.db_id as description,
    COUNT(DISTINCT te.table_name) as table_count,
    COUNT(*) as total_embeddings
  FROM public.table_embeddings te
  WHERE te.db_id = affected_db_id
  GROUP BY te.db_id
  ON CONFLICT (db_id) DO UPDATE SET
    table_count = EXCLUDED.table_count,
    total_embeddings = EXCLUDED.total_embeddings,
    updated_at = NOW();

  -- If this was a delete and no more records exist for this db_id, remove the collection
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.collections 
    WHERE db_id = affected_db_id 
    AND NOT EXISTS (
      SELECT 1 FROM public.table_embeddings WHERE db_id = affected_db_id
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers on table_embeddings to auto-sync collections
DROP TRIGGER IF EXISTS trigger_sync_collections_insert ON public.table_embeddings;
CREATE TRIGGER trigger_sync_collections_insert
  AFTER INSERT ON public.table_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION sync_collections_on_embedding_change();

DROP TRIGGER IF EXISTS trigger_sync_collections_update ON public.table_embeddings;
CREATE TRIGGER trigger_sync_collections_update
  AFTER UPDATE ON public.table_embeddings
  FOR EACH ROW
  WHEN (OLD.db_id IS DISTINCT FROM NEW.db_id OR OLD.table_name IS DISTINCT FROM NEW.table_name)
  EXECUTE FUNCTION sync_collections_on_embedding_change();

DROP TRIGGER IF EXISTS trigger_sync_collections_delete ON public.table_embeddings;
CREATE TRIGGER trigger_sync_collections_delete
  AFTER DELETE ON public.table_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION sync_collections_on_embedding_change(); 