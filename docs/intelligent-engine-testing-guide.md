# Intelligent Engine Testing Guide

## Summary of Changes

### Files Modified
1. **src/utils/signalSeeder.ts** (NEW) - Provides console utilities to seed/check/clear test signals
2. **src/utils/engineDebugLogger.ts** (NEW) - Structured cycle logging for per-symbol decision visibility
3. **src/hooks/useIntelligentTradingEngine.tsx** - Added imports and structured logging

### What Was Blocking
The engine was **not producing normal INTELLIGENT_AUTO intents** because:
- `live_signals` table was empty of recent bullish signals
- `getBuySignal()` checks: whale → news → social → **technical** → AI
- `checkTechnicalBuySignals()` queries `live_signals` for: `ma_cross_bullish`, `rsi_oversold_bullish`, `momentum_bullish`, `trend_bullish`
- With no matching rows, the function returns `false` → no BUY signal

The TEST_ALWAYS_BUY path worked because it **bypasses signal checking** entirely.

---

## Console Commands (DevTools)

### Check Debug History
```javascript
// Get all cycle logs
window.__GET_ENGINE_DEBUG()

// Get logs filtered by symbol
window.__GET_ENGINE_DEBUG('BTC')

// Clear history
window.__CLEAR_ENGINE_DEBUG()
```

### Seed Test Signals
```javascript
// Seed a bullish signal for a symbol (enables normal INTELLIGENT_AUTO BUY)
await window.__SEED_SIGNAL('BTC')
await window.__SEED_SIGNAL('ETH')

// Check recent signals
await window.__CHECK_SIGNALS()  // all signals
await window.__CHECK_SIGNALS('BTC')  // filtered by symbol

// Clear test-seeded signals
await window.__CLEAR_SEEDED_SIGNALS()
```

### Force Engine Triggers (existing)
```javascript
// Force a debug trade (bypasses all gates)
window.__INTELLIGENT_FORCE_DEBUG_TRADE = true

// Force a normal intent emission (for testing pipe)
window.__INTELLIGENT_FORCE_NORMAL_INTENT = true

// Suppress engine logs
window.__INTELLIGENT_SUPPRESS_LOGS = true

// Disable auto-run (manual calls only)
window.__INTELLIGENT_DISABLE_AUTORUN = true
```

---

## Test Scenarios

### Scenario A: TEST_ALWAYS_BUY Sanity Check
**Already working** - This path ignores signals and just checks exposure/cooldown.

**Steps:**
1. Open DevTools console
2. Wait for engine cycle (60 seconds) or trigger manually
3. Check debug history: `window.__GET_ENGINE_DEBUG()`
4. Look for entries with `mode: 'TEST_ALWAYS_BUY'`

**Expected:**
- `symbolDecisions` array shows each coin's status
- Coins within exposure limits show: `finalDecision: 'eligible_for_intelligent_auto_buy'`
- Coins blocked show: `blocked_by_cooldown` or `blocked_by_exposure`
- If `intentEmitted: true`, check `decision_events` and `mock_trades`

**SQL to verify:**
```sql
SELECT id, symbol, source, reason, created_at 
FROM decision_events 
WHERE source = 'intelligent' 
ORDER BY created_at DESC LIMIT 10;

SELECT id, cryptocurrency, trade_type, amount, price, executed_at 
FROM mock_trades 
WHERE is_test_mode = true 
ORDER BY executed_at DESC LIMIT 10;
```

---

### Scenario B: Normal Signal-Based INTELLIGENT_AUTO BUY
**Requires seeding signals into live_signals**

**Steps:**
1. Seed bullish signals:
   ```javascript
   await window.__SEED_SIGNAL('BTC')
   await window.__SEED_SIGNAL('ETH')
   ```
2. Verify signals exist:
   ```javascript
   await window.__CHECK_SIGNALS()
   ```
3. Wait for next engine cycle (60 seconds)
4. Check debug history:
   ```javascript
   window.__GET_ENGINE_DEBUG('BTC')
   ```

**Expected:**
- Symbol shows `hasValidBullishSignal: true`
- `signalFusionResult: 'bullish'`
- `finalDecision: 'eligible_for_intelligent_auto_buy'`
- New row in `decision_events` with `source='intelligent'`
- New row in `mock_trades` with `is_test_mode=true`

**SQL to verify:**
```sql
-- Check seeded signals
SELECT * FROM live_signals 
WHERE source = 'test_seeder' 
ORDER BY created_at DESC;

-- Check if decision was logged
SELECT * FROM decision_events 
WHERE source = 'intelligent' 
AND symbol LIKE 'BTC%' 
ORDER BY created_at DESC LIMIT 5;
```

---

### Scenario C: SELL Path Test in TEST MODE
**Requires an open BUY position first**

**Steps:**
1. Create a test BUY position (use Test BUY button or wait for engine)
2. Check open positions in UI
3. Manually trigger a SELL or wait for TP/SL conditions
4. Check debug history for SELL decision

**Expected:**
- Position appears in mock_trades with `trade_type='buy'`
- When SELL triggers: new row with `trade_type='sell'`
- P&L calculated via FIFO matching

**SQL to verify:**
```sql
-- Open positions (buys without matching sells)
SELECT cryptocurrency, SUM(amount) as total_amount, AVG(price) as avg_price
FROM mock_trades 
WHERE trade_type = 'buy' 
AND is_test_mode = true
GROUP BY cryptocurrency;

-- Recent sells
SELECT * FROM mock_trades 
WHERE trade_type = 'sell' 
AND is_test_mode = true 
ORDER BY executed_at DESC LIMIT 5;
```

---

## Debug History Structure

Each cycle log contains:
```typescript
{
  cycleId: string,
  timestamp: string,
  mode: 'INTELLIGENT_AUTO' | 'TEST_ALWAYS_BUY' | 'FORCED_DEBUG',
  symbolDecisions: [
    {
      symbol: 'BTC-EUR',
      hasValidBullishSignal: boolean,
      blockedByCooldown: boolean,
      cooldownRemainingMs?: number,
      blockedByExposure: boolean,
      exposureDetails?: { current, limit },
      blockedByMaxActiveCoins: boolean,
      signalFusionResult: 'bullish' | 'no_signals' | 'neutral' | ...,
      finalDecision: string,
      reason: string
    },
    // ... more symbols
  ],
  intentEmitted: boolean,
  intentSymbol?: string,
  intentSide?: 'BUY' | 'SELL'
}
```

---

## Key Files Reference

| Concern | File | Function |
|---------|------|----------|
| Exposure calculator | `src/utils/exposureCalculator.ts` | `calculateExposure`, `canBuySymbol`, `findBestSymbolForTrade` |
| Symbol cooldown | `src/utils/symbolCooldown.ts` | `isSymbolInCooldown`, `recordTradeForCooldown`, `getCooldownMs` |
| INTELLIGENT_AUTO BUY | `useIntelligentTradingEngine.tsx` | `checkBuyOpportunitiesInstrumented`, `getBuySignal` |
| TEST_ALWAYS_BUY | `useIntelligentTradingEngine.tsx` | Lines ~810-970 |
| Signal checking | `useIntelligentTradingEngine.tsx` | `checkTechnicalBuySignals`, `checkWhaleSignals`, etc. |
| Coordinator route | `trading-decision-coordinator` | Edge function handles all intelligent decisions |
| Debug logging | `src/utils/engineDebugLogger.ts` | `logEngineCycle`, `createSymbolDecision` |
| Signal seeding | `src/utils/signalSeeder.ts` | `seedBullishSignal`, `checkSignals`, `clearSeededSignals` |

---

## Option D Policy Confirmation

✅ **Exposure-based, not hasPosition-based**: Multiple BUYs per coin allowed within exposure limits  
✅ **maxActiveCoins**: Limits unique coins with exposure, not raw position count  
✅ **Cooldowns**: Delay over-trading but don't permanently block  
✅ **No hidden brakes**: All gates visible in structured debug logs
