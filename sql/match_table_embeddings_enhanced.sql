CREATE OR REPLACE FUNCTION match_table_embeddings(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_db_id text DEFAULT NULL,
  filter_table_name text DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  db_id TEXT,
  table_name TEXT,
  column_name TEXT,
  column_type TEXT,
  text_content TEXT,
  similarity float,
  metadata JSONB
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    db_id,
    table_name,
    column_name,
    column_type,
    text_content,
    1 - (embedding <=> query_embedding) AS similarity,
    metadata
  FROM table_embeddings
  WHERE 1 - (embedding <=> query_embedding) > match_threshold
    AND (filter_db_id IS NULL OR db_id = filter_db_id)
    AND (filter_table_name IS NULL OR table_name = filter_table_name)
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$; 