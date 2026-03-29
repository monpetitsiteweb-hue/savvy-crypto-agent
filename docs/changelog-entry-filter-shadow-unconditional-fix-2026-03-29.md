# Changelog: entry_filter_shadow Unconditional Injection Fix

**Date**: 2026-03-29
**Scope**: Guarantee entry_filter_shadow is always present in market_context_json
**Behavior change**: None — logging only

---

## Problem

`entry_filter_shadow` had ~44% coverage. The field was silently omitted when shadow data was unavailable due to a conditional spread pattern:

```typescript
// OLD — conditional spread: omits field entirely when data is missing
...(fusedSignalData?._entryFilterShadow && { entry_filter_shadow: fusedSignalData._entryFilterShadow })
```

## Fix

### File modified

`supabase/functions/trading-decision-coordinator/index.ts`

### What was changed

In the `market_context_json` object assembly (~line 5487), replaced the conditional spread with an unconditional assignment using nullish coalescing:

```typescript
// NEW — always present, with missing_data fallback
entry_filter_shadow: fusedSignalData?._entryFilterShadow ?? {
  rsi_14: null,
  ema_50: null,
  ema_50_threshold: null,
  current_price: intent.metadata?.currentPrice ?? finalEntryPrice ?? null,
  rsi_condition: null,
  ema50_condition: null,
  would_block: null,
  features_ts: null,
  staleness_min: null,
  granularity: '5m',
  missing_data: true,
}
```

### What was NOT changed

- A3 shadow computation logic (~line 3039) — untouched
- A1 (fear_greed_shadow) and A2 (confidence_shadow) — still use conditional spread (by design)
- No decision logic modified
- No trade execution changes
- No schema changes

---

## Verification

```sql
SELECT
  COUNT(*) FILTER (WHERE market_context_json->'entry_filter_shadow' IS NOT NULL) AS with_shadow,
  COUNT(*) AS total
FROM decision_snapshots
WHERE created_at > now() - interval '15 minutes'
  AND snapshot_type = 'ENTRY';
```

Expected: `with_shadow ≈ total` (~100% coverage).