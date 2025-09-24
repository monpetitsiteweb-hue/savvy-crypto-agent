# Calibration Indexes Setup

## Why Manual Index Creation?

PostgreSQL's `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, but our migration runner wraps all SQL in transactions. Since concurrent index creation is essential for production (to avoid locking tables), we maintain these critical indexes via manual SQL execution.

## How to Apply

### Option A: Supabase SQL Editor
1. Navigate to your Supabase project's SQL Editor
2. Copy the contents of `sql/maintenance/create_calibration_indexes.sql`
3. Paste and execute as-is (each statement runs standalone)

### Option B: psql
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/maintenance/create_calibration_indexes.sql
```

## Important Notes
- **No surrounding BEGIN/COMMIT** - each statement must run standalone
- `CONCURRENTLY` builds indexes without blocking table access
- Safe to run multiple times (uses `IF NOT EXISTS` and `IF EXISTS`)
- Required for optimal calibration aggregator performance

## Indexes Created
- `idx_decision_events_sym_ts` - Fast symbol+timestamp lookups
- `idx_decision_outcomes_horizon` - Horizon-based filtering
- `idx_decision_outcomes_decision_id` - Foreign key optimization
- `idx_decision_events_strategy` - Strategy-based queries
- `idx_decision_outcomes_user` - User-scoped access