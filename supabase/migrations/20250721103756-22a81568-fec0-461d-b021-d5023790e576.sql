-- Add new configuration fields for whale signal providers
ALTER TABLE ai_data_sources ADD COLUMN IF NOT EXISTS webhook_url TEXT;
ALTER TABLE ai_data_sources ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
ALTER TABLE ai_data_sources ADD COLUMN IF NOT EXISTS threshold_amount NUMERIC DEFAULT 50000;
ALTER TABLE ai_data_sources ADD COLUMN IF NOT EXISTS blockchain_networks TEXT[] DEFAULT '{"ethereum"}';
ALTER TABLE ai_data_sources ADD COLUMN IF NOT EXISTS filter_config JSONB DEFAULT '{}';

-- Create a table for tracking webhook events and API responses
CREATE TABLE IF NOT EXISTS whale_signal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES ai_data_sources(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL, -- 'webhook', 'api_poll', 'manual_trigger'
  transaction_hash TEXT,
  amount NUMERIC,
  from_address TEXT,
  to_address TEXT,
  token_symbol TEXT,
  blockchain TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_data JSONB,
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for whale signal events
ALTER TABLE whale_signal_events ENABLE ROW LEVEL SECURITY;

-- Create policies for whale signal events
CREATE POLICY "Users can view their own whale signals" 
  ON whale_signal_events 
  FOR SELECT 
  USING (user_id = auth.uid());

CREATE POLICY "System can insert whale signals" 
  ON whale_signal_events 
  FOR INSERT 
  WITH CHECK (true);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_whale_signals_user_id ON whale_signal_events(user_id);
CREATE INDEX IF NOT EXISTS idx_whale_signals_source_id ON whale_signal_events(source_id);
CREATE INDEX IF NOT EXISTS idx_whale_signals_timestamp ON whale_signal_events(timestamp);

-- Add trigger to update whale signal events timestamp
CREATE TRIGGER update_whale_signals_updated_at
  BEFORE UPDATE ON whale_signal_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();