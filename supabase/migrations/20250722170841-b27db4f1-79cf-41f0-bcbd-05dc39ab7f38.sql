-- Create conversation history table for AI memory
CREATE TABLE public.conversation_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  strategy_id UUID,
  message_type TEXT NOT NULL CHECK (message_type IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.conversation_history ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage their own conversation history" 
ON public.conversation_history 
FOR ALL 
USING (user_id = auth.uid());

-- Add index for performance
CREATE INDEX idx_conversation_history_user_strategy ON public.conversation_history(user_id, strategy_id, created_at);
CREATE INDEX idx_conversation_history_recent ON public.conversation_history(user_id, created_at DESC);