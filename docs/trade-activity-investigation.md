# Trade Activity Investigation — Why No Trades Are Firing

**Date:** 2026-02-25  
**Status:** Discovery Only — No Fixes Applied

---

## Executive Summary

**Root Cause: `BACKEND_ENGINE_MODE` is set to `'SHADOW'` (or defaulting to it).**

The backend-shadow-engine runs every 5 minutes via GitHub Actions cron. However, when `BACKEND_ENGINE_MODE` ≠ `'LIVE'`, the engine evaluates signals but **does NOT send intents to the coordinator** — it only logs shadow decisions. No BUY intents are ever produced in SHADOW mode.

Additionally, no recent logs exist for `backend-shadow-engine` in Supabase, suggesting the GitHub Actions cron may not be running or the function is not being invoked successfully.

---

## 1️⃣ Gating Layer Analysis

### Complete Gate Table

| # | Gate | Location | Active? | Condition that Blocks BUY | Could Block Current State? |
|---|------|----------|---------|---------------------------|---------------------------|
| 1 | **BACKEND_ENGINE_MODE = SHADOW** | `backend-shadow-engine/index.ts:28-29` | **YES — PRIMARY BLOCKER** | When env != 'LIVE', `effectiveShadowMode=true` → engine logs "WOULD_BUY" but never calls coordinator | **YES — This is why no trades fire** |
| 2 | Frontend BUY Block (Phase D) | `coordinator:1291` | YES | `isFrontendIntelligent && side === "BUY"` → BLOCK | YES — frontend cannot produce BUYs |
| 3 | Source Allowlist | `coordinator:1573-1574` | YES | Only `['intelligent', 'manual']` sources accepted | No — engine uses 'intelligent' |
| 4 | Signal Fusion Threshold | `engine:998-1008` | YES | `effectiveFusionScore < enterThreshold (0.15)` AND `momentum ≤ 0.3` | Depends on market — possible |
| 5 | Trend Check | `engine:1002` | YES | `signalScores.trend <= -0.1` | Depends on market |
| 6 | Age Penalty | `engine:980-983` | YES | `trendAgeHours >= 12` → -0.10 penalty to fusion score | Can push below threshold |
| 7 | No Valid Price | `engine:920-921` | YES | Coinbase API returns 0 or error | Unlikely |
| 8 | No Active Strategies | `engine:590` | YES | `!strategies?.length` | Unlikely if strategy exists |
| 9 | Idempotency Dedup (5s window) | `coordinator:1497-1526` | YES (backend live only) | Duplicate BUY within 5 seconds | Only if engine sends duplicates |
| 10 | Canonical Config Missing | `coordinator:892-953` | YES | Missing any of 7 required keys → `blocked_missing_config` | Possible if config incomplete |
| 11 | is_open_position Conflict | `coordinator:1665-1678` | YES | DB unique index prevents duplicate open positions per symbol | Blocks if position already open |
| 12 | UD Exposure Guards (detectConflicts) | `coordinator` | YES (when UD=ON) | `totalExposureEUR + tradeValueEUR > maxWalletExposureEUR` | YES — exposure is 85,200€ vs 24,000€ cap |
| 13 | Max Active Coins | `detectConflicts()` | YES (when UD=ON) | Too many symbols with open positions | Possible |
| 14 | Per-Symbol Exposure | `detectConflicts()` | YES (when UD=ON) | Single symbol exceeds allocation limit | Possible |
| 15 | Circuit Breakers | `execution_circuit_breakers` table | Depends on state | Tripped breaker blocks trades | Unknown |
| 16 | Stop-Loss Cooldown | `coordinator` | YES | Recent SL exit blocks re-entry | Possible |
| 17 | Entry Spacing (minEntrySpacingMs) | `coordinator` | YES | Too-recent BUY on same symbol | Possible |
| 18 | Hold Period (minHoldPeriodMs) | `coordinator` | YES (SELLs only) | Position not held long enough | N/A for BUY |
| 19 | Daily Loss Limit | If configured | Strategy-dependent | Daily losses exceed limit | Unknown |
| 20 | enableLiveTrading / enableTestTrading | Strategy config | N/A at coordinator level | These flags are NOT checked by coordinator or engine for BUY gating | No |
| 21 | `FRONTEND_ENGINE_DISABLED` | Frontend hook | YES | Frontend engine disabled, cannot produce intents | YES — but irrelevant since Phase D blocks frontend BUYs anyway |

### Critical Path Analysis

The execution path for automated BUYs is:

```
GitHub Actions CRON (every 5 min)
  → POST /functions/v1/backend-shadow-engine
    → BACKEND_ENGINE_MODE check
      → IF 'SHADOW': evaluate signals, log shadow decisions, STOP (no coordinator call)
      → IF 'LIVE': evaluate signals, call coordinator with BUY intent
        → Coordinator gates (UD, exposure, config, dedup, etc.)
          → Insert into mock_trades
```

**Gate #1 (SHADOW mode) terminates the entire pipeline before any coordinator call.**

---

## 2️⃣ Scheduler / Signal Loop Status

### Is the automated trading loop running?

**Partially.** The GitHub Actions cron (`backend-shadow-engine-5min.yml`) is configured to run every 5 minutes. However:

- **No recent logs** found for `backend-shadow-engine` in Supabase edge function logs
- This could mean:
  a) GitHub Actions is not running (repo may be paused/disabled)
  b) The function is being called but Supabase is not retaining logs
  c) The CRON secret or Supabase URL is misconfigured in GitHub secrets

### Is BACKEND_ENGINE_MODE set to LIVE?

**Unknown value.** The secret `BACKEND_ENGINE_MODE` exists in Supabase secrets, but its value is encrypted. The code defaults to `'SHADOW'` if unset:

```typescript
const BACKEND_ENGINE_MODE: EngineMode = 
  (Deno.env.get('BACKEND_ENGINE_MODE') as EngineMode) || 'SHADOW';
```

**If it's set to `'SHADOW'` or not set at all → no BUYs will ever fire.**

### Are signals being produced?

**Yes.** The `technical-signal-generator` and other signal sources are producing signals (visible in `live_signals` table). The `backend-shadow-engine` would consume these via `computeSignalScores()`.

### Are signals being dropped before reaching coordinator?

**Yes — by design in SHADOW mode.** When `effectiveShadowMode = true` (line 570), the engine evaluates signals and logs the result but **never calls the coordinator**. The intent is constructed but only logged as a shadow decision.

### `trading-scheduler` Status

**Fully deprecated.** The `trading-scheduler/index.ts` returns immediately with a deprecation notice (line 33). It is dead code.

---

## 3️⃣ Manual Trade Capability in Test Mode

### Does a Manual BUY path exist?

**YES.** The `TestBuyModal` component (`src/components/strategy/TestBuyModal.tsx`) provides a UI for manual test BUYs.

**How it works:**
1. User selects symbol, EUR amount, optional price override
2. Component builds intent with `source: 'manual'`, `metadata.is_test_mode: true`, `metadata.ui_seed: true`
3. Calls coordinator via `supabase.functions.invoke('trading-decision-coordinator', { body: { intent } })`
4. Coordinator detects fast path at line 1603-1768:
   ```
   intent.side === 'BUY' && intent.source === 'manual' && 
   intent.metadata?.is_test_mode === true && intent.metadata?.ui_seed === true
   ```
5. Inserts directly into `mock_trades` — **bypasses ALL exposure/UD/conflict gates**

**Fast path gates (minimal):**
- Validates qty > 0 and price > 0
- Checks `is_open_position` unique constraint (blocks if position already open for symbol)
- Validates canonical config (7 keys must exist)

### Does a Manual SELL path exist?

**Yes.** Manual SELLs are allowed via `source: 'manual'` or `context: 'MANUAL'` (coordinator lines 1335-1339).

### Can the TestBuyModal be reached from the UI?

**Yes** — it's imported in strategy components. The user should be able to trigger it from the strategy detail page.

---

## 4️⃣ Can the Coordinator Be Triggered Directly?

### YES — Multiple methods:

#### Method 1: Supabase Function Invocation (from browser/code)
```javascript
const { data, error } = await supabase.functions.invoke('trading-decision-coordinator', {
  body: {
    intent: {
      userId: '<USER_ID>',
      strategyId: '<STRATEGY_ID>',
      symbol: 'BTC',
      side: 'BUY',
      source: 'manual',        // MUST be 'manual' or 'intelligent'
      confidence: 1.0,
      qtySuggested: 0.001,     // qty in crypto units
      metadata: {
        is_test_mode: true,
        ui_seed: true,          // REQUIRED for manual fast path
        price_used: 55000,      // REQUIRED for fast path
        eur_amount: 500,
        position_management: true,
      }
    }
  }
});
```

#### Method 2: curl (with service role key)
```bash
curl -X POST \
  'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/trading-decision-coordinator' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "intent": {
      "userId": "<USER_ID>",
      "strategyId": "<STRATEGY_ID>",
      "symbol": "BTC",
      "side": "BUY",
      "source": "manual",
      "confidence": 1.0,
      "qtySuggested": 0.001,
      "metadata": {
        "is_test_mode": true,
        "ui_seed": true,
        "price_used": 55000,
        "eur_amount": 500
      }
    }
  }'
```

#### Method 3: Existing Test Files
- `trigger_test_decision.html` — Browser-based test (uses anon key)
- `manual_test_coordinator.js` — Node.js test script
- `test_coordinator_direct.js` — Payload reference

**Note:** For the manual fast path to work, the intent MUST have:
- `source: 'manual'`
- `metadata.is_test_mode: true`
- `metadata.ui_seed: true`
- `metadata.price_used: <number>`
- Valid `qtySuggested > 0`

Without `ui_seed: true`, the intent falls through to the standard UD path, which will hit exposure guards.

---

## 5️⃣ Why No Trades Are Happening — Summary

### Primary Cause: SHADOW Mode
1. `BACKEND_ENGINE_MODE` is either `'SHADOW'` or unset (defaults to `'SHADOW'`)
2. In SHADOW mode, the engine evaluates signals → logs decisions → **stops** (never calls coordinator)
3. No BUY intents reach the coordinator from the automated pipeline

### Secondary Cause: No Engine Logs
4. No recent `backend-shadow-engine` logs in Supabase → the cron may not be executing at all
5. If GitHub Actions is paused or misconfigured, even SHADOW evaluations aren't running

### Tertiary Cause: Frontend Blocked
6. Phase D (coordinator line 1291) blocks ALL frontend automatic BUYs
7. `FRONTEND_ENGINE_DISABLED = true` in frontend hooks
8. Only manual UI trades (TestBuyModal) can bypass this

### Exposure Guards (if engine were LIVE)
9. Even if `BACKEND_ENGINE_MODE` were `'LIVE'`, the UD=ON exposure guards would likely block BUYs because:
   - `totalExposureEUR` ≈ 85,200€
   - `maxWalletExposureEUR` = 30,000 × 0.80 = 24,000€
   - **85,200 + any new trade > 24,000** → BLOCK

### To Enable Automated BUYs, ALL of these must be resolved:
1. Set `BACKEND_ENGINE_MODE` secret to `'LIVE'`
2. Confirm GitHub Actions cron is running
3. Either reduce exposure or increase wallet cap
4. Ensure canonical config has all 7 required keys

---

## 6️⃣ Immediate Manual Test Path

**The TestBuyModal (`src/components/strategy/TestBuyModal.tsx`) is the only working BUY path.**

It bypasses:
- SHADOW mode (not applicable — it's UI-driven)
- Frontend BUY block (it uses `source: 'manual'`, not `intelligent`)
- UD/exposure guards (fast path bypasses `detectConflicts()`)
- Signal fusion thresholds (manual trade, no signal evaluation)

It is subject to:
- `is_open_position` unique constraint (one open position per symbol)
- Canonical config validation (7 keys must exist)
- Basic qty/price validation

---

*No code changes were made. This document is investigation-only.*
