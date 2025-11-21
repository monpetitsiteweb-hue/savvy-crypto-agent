# Verify decision_events Source Constraint Update

## Migration Details
- **File**: `supabase/migrations/20251219000000_update_decision_events_source_constraint.sql`
- **Purpose**: Allow 'intelligent' and 'mock' as valid source values in decision_events table

## Verification SQL

### 1. Check the constraint definition
```sql
SELECT 
  constraint_name, 
  check_clause 
FROM information_schema.check_constraints 
WHERE constraint_schema = 'public' 
  AND constraint_name = 'decision_events_source_ck';
```

**Expected Result:**
```
constraint_name              | check_clause
-----------------------------+------------------------------------------------------
decision_events_source_ck    | (source = ANY (ARRAY['automated', 'manual', 'mock', 'intelligent']))
```

### 2. Test inserting a decision event with source='intelligent'
```sql
-- Test insert (will be rolled back)
BEGIN;

INSERT INTO public.decision_events (
  user_id,
  strategy_id,
  symbol,
  side,
  source,
  confidence,
  reason
) VALUES (
  '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
  '5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e',
  'SOL',
  'BUY',
  'intelligent',  -- This should now work
  0.50,
  'Test insert after constraint update'
);

-- Check if insert succeeded
SELECT id, symbol, side, source, confidence 
FROM public.decision_events 
WHERE source = 'intelligent' 
ORDER BY decision_ts DESC 
LIMIT 1;

ROLLBACK;  -- Rollback test insert
```

### 3. Verify existing data is unaffected
```sql
SELECT 
  source, 
  COUNT(*) as count 
FROM public.decision_events 
GROUP BY source 
ORDER BY source;
```

## Test with trading-decision-coordinator

After running the migration, test the coordinator:

```powershell
$EXEC = "https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1"
$ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aWVwbGZ0bGN4ZGZreHlxemx0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIyMjg3OTQsImV4cCI6MjA2NzgwNDc5NH0.t1DwSViIf_ya-7fUTqM5d56CPINq0JdAYt-YFJs8fa8"

$Headers = @{
  Authorization = "Bearer $ANON"
  apikey        = $ANON
  "Content-Type" = "application/json"
}

$Body = @{
  userId       = "25a0c221-1f0e-431d-8d79-db9fb4db9cb3"
  strategyId   = "5f0664fd-98cb-4ec2-8c2b-95cb1a28b80e"
  symbol       = "SOL-EUR"
  side         = "BUY"
  source       = "intelligent"
  confidence   = 0.50
  qtySuggested = 0.05
  metadata     = @{
    mode = "mock"
  }
} | ConvertTo-Json -Depth 5

$Response = Invoke-RestMethod -Uri "$EXEC/trading-decision-coordinator" -Method Post -Headers $Headers -Body $Body
$Response | ConvertTo-Json -Depth 10
```

### Verify the decision was logged
```sql
SELECT 
  id, 
  symbol, 
  side, 
  source, 
  confidence, 
  reason, 
  decision_ts
FROM public.decision_events
WHERE source = 'intelligent'
ORDER BY decision_ts DESC
LIMIT 5;
```

## Expected Outcomes

✅ **Success Criteria:**
1. Constraint allows 'automated', 'manual', 'mock', 'intelligent'
2. No database errors when inserting with source='intelligent'
3. trading-decision-coordinator can successfully log decision events
4. No existing data is affected or lost
5. Edge function logs show: `✅ LEARNING: Successfully logged decision event row`

❌ **Failure Indicators:**
- Still getting "violates check constraint" errors
- Coordinator logs show: `❌ LEARNING: decision_events insert failed`
- Constraint still only allows 'automated' and 'manual'
