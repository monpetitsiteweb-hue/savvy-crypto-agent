-- Create execution_holds table for symbol quarantine
CREATE TABLE IF NOT EXISTS execution_holds (
  user_id uuid NOT NULL,
  symbol text NOT NULL,
  hold_until timestamptz NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);

-- Add RLS policies for execution_holds
ALTER TABLE execution_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own execution holds" 
ON execution_holds 
FOR ALL 
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());