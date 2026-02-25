# Runtime Exposure Instrumentation (TEMP DIAGNOSTIC)

## Purpose

Add temporary structured logging to `detectConflicts()` inside `trading-decision-coordinator` to capture **real numeric values** at runtime. No logic changes, no filters, no refactors — logging only.

## Context

Static analysis (see `docs/exposure-math-validation.md`) confirmed:

- Wallet denominator is static: `cfg.walletValueEUR || 30000`
- Exposure uses cost-basis: `netQty × avgBuyPrice`
- Query does NOT filter `is_test_mode`
- Query has no `.limit()` override → 1000-row truncation risk
- Query failure defaults to `totalExposureEUR = 0` (fail-open)
- Open exposure in DB: ~€85,200
- Expected cap (static): `30,000 × 0.8 = €24,000`
- 142 BUY trades were allowed

We need runtime proof of the numeric flow to confirm which failure mode occurred.

---

## What Was Changed

### File Modified

`supabase/functions/trading-decision-coordinator/index.ts`

### Change 1: Capture Query Error (lines ~5397-5416)

**Before:**
```typescript
const { data: allTrades } = await supabaseClient
  .from("mock_trades")
  .select("cryptocurrency, amount, price, trade_type")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("trade_type", ["buy", "sell"])
  .order("executed_at", { ascending: false });
```

**After:**
```typescript
const { data: allTrades, error: tradesQueryError } = await supabaseClient
  .from("mock_trades")
  .select("cryptocurrency, amount, price, trade_type")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("trade_type", ["buy", "sell"])
  .order("executed_at", { ascending: false });

// === TEMP INSTRUMENTATION: Query status ===
console.log(`[EXPOSURE_DIAG] tradesQueryStatus: ${tradesQueryError ? "ERROR" : "OK"}, tradesRowCount: ${allTrades?.length ?? "null"}`);
if (tradesQueryError) {
  console.log(`[EXPOSURE_DIAG] tradesQueryError:`, JSON.stringify(tradesQueryError));
}
if (allTrades?.length === 1000) {
  console.log(`[EXPOSURE_DIAG] ⚠️ possibleTruncation: true — query returned exactly 1000 rows`);
}
if (allTrades && allTrades.length > 0) {
  console.log(`[EXPOSURE_DIAG] sampleFirst5Trades:`, JSON.stringify(allTrades.slice(0, 5)));
  console.log(`[EXPOSURE_DIAG] sampleLast5Trades:`, JSON.stringify(allTrades.slice(-5)));
}
```

**What this captures:**
- Whether the Supabase query succeeded or failed silently
- Exact row count returned (to detect 1000-row truncation)
- First 5 and last 5 trades (to verify chronological coverage)
- Explicit truncation warning if exactly 1000 rows returned

---

### Change 2: Full Diagnostic Snapshot (lines ~5466-5488)

Added a structured JSON log block immediately before the exposure comparison:

```typescript
console.log(`[EXPOSURE_DIAG] FULL_SNAPSHOT:`, JSON.stringify({
  walletValueEUR,
  cfgWalletValueEUR: cfg.walletValueEUR,
  resolvedWalletValueEUR: walletValueEUR,
  maxWalletExposurePct,
  cfgMaxWalletExposure: cfg.maxWalletExposure,
  cfgRiskMgmtMaxWalletExposure: cfg.riskManagement?.maxWalletExposure,
  resolvedMaxWalletExposurePct: maxWalletExposurePct,
  maxWalletExposureEUR,
  totalExposureEUR,
  tradeValueEUR,
  tradesRowCount: allTrades?.length ?? null,
  tradesQueryError: tradesQueryError ? tradesQueryError.message : null,
  intentSide: intent.side,
  strategyId: intent.strategyId,
  isTestMode: cfg.isTestMode ?? cfg.is_test_mode ?? "not_in_config",
  comparisonResult: `${totalExposureEUR} + ${tradeValueEUR} = ${totalExposureEUR + tradeValueEUR} vs cap ${maxWalletExposureEUR}`,
  wouldBlock: (totalExposureEUR + tradeValueEUR) > maxWalletExposureEUR,
}));
```

**What this captures:**

| Field | Purpose |
|---|---|
| `walletValueEUR` | Resolved wallet denominator (expected: 30000) |
| `cfgWalletValueEUR` | Raw config value (may be `undefined`) |
| `maxWalletExposurePct` | Resolved percentage after `Math.min()` |
| `cfgMaxWalletExposure` | Raw top-level config value |
| `cfgRiskMgmtMaxWalletExposure` | Raw nested `riskManagement` value |
| `maxWalletExposureEUR` | Computed cap in EUR (`walletValueEUR × pct / 100`) |
| `totalExposureEUR` | Aggregated cost-basis exposure from query |
| `tradeValueEUR` | Value of the incoming trade (`perTradeAllocation`) |
| `tradesRowCount` | Number of rows returned (truncation detection) |
| `tradesQueryError` | Error message if query failed |
| `intentSide` | Should always be `"BUY"` in this branch |
| `strategyId` | Which strategy triggered |
| `isTestMode` | Config value for test mode (isolation check) |
| `comparisonResult` | Human-readable math string |
| `wouldBlock` | Boolean — whether the cap SHOULD block this trade |

---

## What Was NOT Changed

- ❌ No exposure logic modified
- ❌ No filters added to the query
- ❌ No `is_test_mode` filter added
- ❌ No `.limit()` override added
- ❌ No cap thresholds changed
- ❌ No UD routing logic touched
- ❌ No architectural refactor

---

## Deployment

- Function `trading-decision-coordinator` was redeployed via `deploy_edge_functions`
- Instrumentation is **live** as of deployment
- Logs will appear under `[EXPOSURE_DIAG]` prefix in edge function logs

---

## How to Use

1. Wait for the next BUY intent to fire (or trigger one manually)
2. Check coordinator edge function logs for `[EXPOSURE_DIAG]`
3. Look for `FULL_SNAPSHOT` JSON — contains all numeric values
4. Manually verify: does `totalExposureEUR + tradeValueEUR > maxWalletExposureEUR`?
5. Check `tradesRowCount` — if exactly 1000, truncation is confirmed
6. Check `tradesQueryError` — if non-null, fail-open is confirmed

---

## Expected Log Output (Example)

```json
{
  "walletValueEUR": 30000,
  "cfgWalletValueEUR": undefined,
  "resolvedWalletValueEUR": 30000,
  "maxWalletExposurePct": 80,
  "cfgMaxWalletExposure": 80,
  "cfgRiskMgmtMaxWalletExposure": 100,
  "resolvedMaxWalletExposurePct": 80,
  "maxWalletExposureEUR": 24000,
  "totalExposureEUR": 85200,
  "tradeValueEUR": 600,
  "tradesRowCount": 142,
  "tradesQueryError": null,
  "intentSide": "BUY",
  "strategyId": "5f0664fd-...",
  "isTestMode": "not_in_config",
  "comparisonResult": "85200 + 600 = 85800 vs cap 24000",
  "wouldBlock": true
}
```

If `wouldBlock: true` appears, the cap logic IS correct — the bypass happened upstream (UD=OFF path skipping `detectConflicts()` entirely).

If `wouldBlock: false`, the numeric inputs are wrong and further investigation is needed.

---

## Cleanup

These logs are **temporary**. After capturing one full BUY cycle, the `[EXPOSURE_DIAG]` blocks should be removed in a follow-up commit.
