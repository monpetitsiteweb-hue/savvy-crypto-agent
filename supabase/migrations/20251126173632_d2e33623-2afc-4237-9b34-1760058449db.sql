-- Enable pgvector extension if not already enabled (for embeddings)
CREATE EXTENSION IF NOT EXISTS vector;

-- Table for storing knowledge documents from various sources
CREATE TABLE public.knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES public.ai_data_sources(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by source
CREATE INDEX idx_knowledge_documents_source_id ON public.knowledge_documents(source_id);

-- Index for fast lookups by user
CREATE INDEX idx_knowledge_documents_user_id ON public.knowledge_documents(user_id);

-- RLS policies
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own knowledge documents"
  ON public.knowledge_documents
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own knowledge documents"
  ON public.knowledge_documents
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own knowledge documents"
  ON public.knowledge_documents
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own knowledge documents"
  ON public.knowledge_documents
  FOR DELETE
  USING (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_knowledge_documents_updated_at
  BEFORE UPDATE ON public.knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Table for storing vector embeddings of knowledge chunks
CREATE TABLE public.knowledge_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI ada-002 dimensions
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by document
CREATE INDEX idx_knowledge_embeddings_document_id ON public.knowledge_embeddings(document_id);

-- Index for vector similarity search
CREATE INDEX idx_knowledge_embeddings_embedding ON public.knowledge_embeddings 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- RLS policies (inherit from parent document's user_id)
ALTER TABLE public.knowledge_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view embeddings for their own documents"
  ON public.knowledge_embeddings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents
      WHERE knowledge_documents.id = knowledge_embeddings.document_id
        AND knowledge_documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create embeddings for their own documents"
  ON public.knowledge_embeddings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.knowledge_documents
      WHERE knowledge_documents.id = knowledge_embeddings.document_id
        AND knowledge_documents.user_id = auth.uid()
    )
  );