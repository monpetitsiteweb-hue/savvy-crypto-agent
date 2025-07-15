-- Create LLM configurations table for dynamic system prompts
CREATE TABLE public.llm_configurations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  system_prompt TEXT NOT NULL DEFAULT 'You are a cryptocurrency trading assistant. Help users analyze and modify their trading strategies. Always be direct and concise. Do not use emojis or icons in your responses. Focus on the user''s exact request and maintain context from previous messages.',
  temperature DECIMAL(3,2) NOT NULL DEFAULT 0.3,
  max_tokens INTEGER NOT NULL DEFAULT 2000,
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  provider TEXT NOT NULL DEFAULT 'openai',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.llm_configurations ENABLE ROW LEVEL SECURITY;

-- Create policies for admin access only
CREATE POLICY "Only admins can manage LLM configurations" 
ON public.llm_configurations 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_llm_configurations_updated_at
BEFORE UPDATE ON public.llm_configurations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default configuration
INSERT INTO public.llm_configurations (system_prompt, temperature, max_tokens) 
VALUES (
  'You are a cryptocurrency trading assistant. Help users analyze and modify their trading strategies. Always be direct and concise. Do not use emojis or icons in your responses. Focus on the user''s exact request and maintain context from previous messages. When users make change requests like "Change it to 3", understand the context from their previous question and make the appropriate modification.',
  0.3,
  2000
);