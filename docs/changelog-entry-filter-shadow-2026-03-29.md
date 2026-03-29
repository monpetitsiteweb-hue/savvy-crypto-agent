# Changelog: entry_filter_shadow Implementation

**Date**: 2026-03-29
**Scope**: Shadow-mode RSI + EMA50 entry filter logging
**Behavior change**: None — shadow observation only

---

## What was added

### A3: entry_filter_shadow (trading-decision-coordinator)

A new shadow observation block added after existing A1 (fear_greed_shadow) and A2 (confidence_shadow).

**Location**: `supabase/functions/trading-decision-coordinator/index.ts`
- Inserted after line ~3843 (after A2 confidence_shadow block)
- Spread into `market_context_json` at snapshot insertion

### Logic

```
RSI(14) < 40 AND Price < EMA50 × 0.995
```

- Fetches latest 5m features from `market_features_v0` for the current symbol
- Computes `would_block`: true if this is a BUY and the filter conditions are NOT met
- Logs staleness (minutes since feature timestamp)

### Validated symbols (forward-only)

| Symbol   | OHLCV rows | Status |
|----------|-----------|--------|
| BTC-EUR  | 8,893     | ✅ Clean |
| ETH-EUR  | 8,872     | ✅ Clean |
| SOL-EUR  | 8,870     | ✅ Clean |
| LTC-EUR  | 8,840     | ✅ Clean |
| XRP-EUR  | 8,829     | ✅ Clean |

### Deferred symbols

- ADA-EUR, LINK-EUR: ~7,700 / 5,800 rows — evaluate later
- AVAX-EUR, BCH-EUR, DOT-EUR: incomplete due to Coinbase data gaps — excluded

### Data logged per decision (in `decision_snapshots.market_context_json`)

```json
{
  "entry_filter_shadow": {
    "rsi_14": 38.42,
    "ema_50": 82145.30,
    "ema_50_threshold": 81734.67,
    "current_price": 81500.00,
    "rsi_condition": true,
    "ema50_condition": true,
    "would_block": false,
    "features_ts": "2026-03-29T10:30:00Z",
    "staleness_min": 3,
    "granularity": "5m"
  }
}
```

### Console logging

```
[entry_filter_shadow] BTC-EUR: rsi=38.4 ema50=82145.30 price=81500 rsi_ok=true ema_ok=true would_block=false staleness=3min
```

---

## Files modified

| File | Change |
|------|--------|
| `supabase/functions/trading-decision-coordinator/index.ts` | Added A3 shadow block + spread into market_context_json |

## Files created

| File | Purpose |
|------|---------|
| `docs/changelog-entry-filter-shadow-2026-03-29.md` | This changelog |

---

## What was NOT changed

- No coordinator behavior changes
- No fusion score modifications
- No trade execution logic changes
- No workflow changes
- No backfill changes
- No schema migrations

## Next steps

1. Monitor `decision_snapshots.market_context_json.entry_filter_shadow` over 2-3 weeks
2. Analyze `would_block` frequency and correlation with trade outcomes
3. Phase 2 activation only after forward validation confirms improvement
