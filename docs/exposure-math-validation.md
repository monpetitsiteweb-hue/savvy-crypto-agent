# Exposure + Equity Math Validation (NO CODE CHANGES)

## 1️⃣ How is wallet equity computed inside `detectConflicts()`?

**It is NOT computed. It uses a STATIC config value.**

Exact code (line 5386):
```typescript
const walletValueEUR = cfg.walletValueEUR || 30000; // Test mode default
```

| Source | Used? |
|---|---|
| `configuration.walletValueEUR` (static config) | ✅ YES — this is the ONLY source |
| Live cash balance | ❌ NO |
| `get_portfolio_metrics()` RPC | ❌ NO |
| `SUM(mock_trades)` | ❌ NO |
| Mark-to-market | ❌ NO |
| Cost basis reconstruction | ❌ NO |

**The denominator is a static number from strategy configuration.** If `walletValueEUR` is not set in the config, it silently falls back to `30000`. This means the exposure cap never adapts to actual portfolio equity — it's anchored to whatever was configured at strategy creation time.

**Implication**: If the wallet has grown to €50k or shrunk to €10k through PnL, the cap still uses the original configured value (or the 30k default).

---

## 2️⃣ How is `totalExposureEUR` computed?

### Query (lines 5397-5403):
```typescript
const { data: allTrades } = await supabaseClient
  .from("mock_trades")
  .select("cryptocurrency, amount, price, trade_type")
  .eq("user_id", intent.userId)
  .eq("strategy_id", intent.strategyId)
  .in("trade_type", ["buy", "sell"])
  .order("executed_at", { ascending: false });
```

**Notable**: No `is_test_mode` filter. No limit clause (risks hitting Supabase 1000-row default).

### Aggregation logic (lines 5407-5441):

```typescript
const qtyBySymbol: Record<string, { netQty: number; avgPrice: number; buyQty: number }> = {};

for (const trade of allTrades || []) {
  const sym = trade.cryptocurrency.replace("-EUR", "");
  const qty = parseFloat(trade.amount);
  const price = parseFloat(trade.price);

  if (!qtyBySymbol[sym]) {
    qtyBySymbol[sym] = { netQty: 0, avgPrice: 0, buyQty: 0 };
  }

  if (trade.trade_type === "buy") {
    const prevTotal = qtyBySymbol[sym].buyQty * qtyBySymbol[sym].avgPrice;
    qtyBySymbol[sym].buyQty += qty;
    qtyBySymbol[sym].avgPrice =
      qtyBySymbol[sym].buyQty > 0 ? (prevTotal + qty * price) / qtyBySymbol[sym].buyQty : price;
    qtyBySymbol[sym].netQty += qty;
  } else {
    qtyBySymbol[sym].netQty -= qty;
  }
}

// Exposure = netQty * avgBuyPrice (NOT current market price)
let totalExposureEUR = 0;
for (const [sym, data] of Object.entries(qtyBySymbol)) {
  if (data.netQty > 0) {
    const exposureEUR = data.netQty * data.avgPrice;
    totalExposureEUR += exposureEUR;
  }
}
```

### What this math does:

| Question | Answer |
|---|---|
| Sums cost basis of open BUY lots? | ⚠️ PARTIALLY — uses weighted average buy price × net qty |
| Uses FIFO reconstruction? | ❌ NO — uses simple net qty (buys - sells) |
| Uses `original_purchase_amount`? | ❌ NO — not queried |
| Uses latest market price? | ❌ NO — uses `avgPrice` (weighted average of BUY prices) |
| Uses `executed_at` price? | ✅ YES — `trade.price` is the execution price |
| Subtracts partial sells? | ✅ YES — sells reduce `netQty` |

### Exposure valuation method:

**`netQty × avgBuyPrice`** = cost-basis exposure, NOT mark-to-market.

This means:
- If BTC was bought at €50k and is now at €100k, exposure is still counted at €50k
- Actual mark-to-market exposure could be significantly higher
- Conversely, if price dropped, real exposure is lower than calculated

### Missing `is_test_mode` filter:

The query does NOT filter by `is_test_mode`. Real and test trades are aggregated together for exposure calculation.

### 1000-row limit risk:

No `.limit()` is specified. Supabase defaults to 1000 rows. With 142+ BUY trades plus sells, this could silently truncate older trades, making `totalExposureEUR` an UNDERCOUNT. The `order("executed_at", { ascending: false })` means oldest trades are dropped first — so early buys that haven't been sold would be invisible, further reducing the calculated exposure.

---

## 3️⃣ Which config path is used for `maxWalletExposure`?

Exact code (line 5387):
```typescript
const maxWalletExposurePct = Math.min(
  cfg.maxWalletExposure || 80,
  cfg.riskManagement?.maxWalletExposure || 80
);
```

### Resolution:

| Config path | Fallback | Used? |
|---|---|---|
| `configuration.maxWalletExposure` | 80 | ✅ YES |
| `configuration.riskManagement.maxWalletExposure` | 80 | ✅ YES |
| Hardcoded constant | N/A | ❌ NO (but fallback IS hardcoded: 80) |
| `default_strategy_config` table | N/A | ❌ NOT USED HERE |

**If both exist, the MINIMUM wins** (via `Math.min`).

**Edge case**: If `cfg.maxWalletExposure = 100` and `cfg.riskManagement.maxWalletExposure = 80`, then `Math.min(100, 80) = 80`.

**Edge case**: If `cfg.maxWalletExposure = 0` (falsy), the `|| 80` makes it 80. Zero is not a valid input. Same for any falsy value.

**⚠️ VIOLATION**: This uses `|| 80` hardcoded defaults, which violates the fail-closed config resolution principle (no inline defaults). Per the architectural rule, missing config should BLOCK, not silently default.

---

## 4️⃣ What exact comparison is made?

### Numeric flow with user's known values:

Given:
- `walletValueEUR` = `cfg.walletValueEUR || 30000` → **30,000** (assuming not set in config)
- `maxWalletExposurePct` = `Math.min(80, 100)` → **80** (if both configs are present with those values)
- `maxWalletExposureEUR` = `30,000 × (80 / 100)` = **24,000**
- `perTradeAllocation` = `cfg.perTradeAllocation || 50` → **600** (if set) or **50** (if not)
- `tradeValueEUR` = `perTradeAllocation` → **600** (or 50)

### The comparison (line 5456):
```typescript
if (totalExposureEUR + tradeValueEUR > maxWalletExposureEUR)
```

### With real data (142 lots × 600€):

If `perTradeAllocation = 600` and trades all went through:
- `totalExposureEUR` ≈ some fraction of 85,200€ (depends on sells and 1000-row truncation)
- `tradeValueEUR` = 600
- `maxWalletExposureEUR` = 24,000

**24,600 > 24,000 should have blocked at ~40 trades** if the math was reached.

### BUT — two possible failure modes:

**Failure Mode A: UD=OFF bypass**
If strategy had `enableUnifiedDecisions = false` at any point, `detectConflicts()` was never called. This is the confirmed root cause from prior analysis.

**Failure Mode B: 1000-row truncation**
If >1000 trades exist, the query truncates. Early BUYs disappear from the calculation, reducing `totalExposureEUR`. With enough sells interspersed, the calculated exposure could stay under the cap even though actual exposure is much higher.

**Failure Mode C: `walletValueEUR` set very high**
If `cfg.walletValueEUR` is set to, say, 200,000 in the config, then `maxWalletExposureEUR = 200,000 × 0.8 = 160,000` — and 85,200€ would pass.

---

## 5️⃣ Could `detectConflicts()` be returning early before exposure checks?

The exposure check is gated by (line 5384):
```typescript
if (intent.side === "BUY") {
```

### Possible early-exit conditions before line 5384:

To answer this precisely, the function has several prior phases that can return early:

| Phase | Can it return before exposure? | Condition |
|---|---|---|
| Phase 1: Cooldown | ✅ YES | If same-symbol trade within cooldown window |
| Phase 2: Hold period | ✅ YES | If SELL blocked by hold period |
| Phase 3: Duplicate detection | ✅ YES | If duplicate intent detected |
| Phase 4: Signal alignment | ✅ YES | If signals contradict |
| Phase 5: Exposure | — | THIS IS the exposure check |

**However**: Phases 1-4 would cause `hasConflict: true` with a different reason — they would BLOCK trades, not let them through. An early return from these phases would prevent buying, not enable it.

### Other early-exit risks specific to Phase 5:

| Risk | Impact |
|---|---|
| `intent.side !== "BUY"` | Entire Phase 5 skipped — but SELLs SHOULD skip exposure checks |
| `strategyConfig` is null/undefined | `cfg = {}`, all values fall to defaults — exposure still runs with defaults |
| `allTrades` query returns error | `allTrades` would be null, loop iterates over `[]`, `totalExposureEUR = 0` — **every BUY passes** |
| `allTrades` query returns 0 rows | Same as above — `totalExposureEUR = 0`, all BUYs pass |
| `parseFloat` returns NaN | Exposure math produces NaN, `NaN > 24000` is `false` — **BUY passes** |

**Critical finding**: If the `allTrades` query fails silently (Supabase returns `{ data: null, error: ... }`), the code does `for (const trade of allTrades || [])` which iterates over `[]`, resulting in `totalExposureEUR = 0`. **Every BUY would pass exposure checks** because `0 + 600 > 24000` is `false`.

---

## SUMMARY TABLE

| Component | Value / Method | Issue? |
|---|---|---|
| Wallet equity denominator | Static `cfg.walletValueEUR \|\| 30000` | ⚠️ Not dynamic — ignores PnL |
| Exposure valuation | `netQty × avgBuyPrice` (cost basis) | ⚠️ Not mark-to-market |
| `maxWalletExposurePct` resolution | `Math.min(cfg.maxWalletExposure \|\| 80, cfg.riskManagement?.maxWalletExposure \|\| 80)` | ⚠️ Hardcoded fallbacks violate fail-closed |
| `maxWalletExposureEUR` | `30000 × 0.8 = 24,000` (with defaults) | |
| `tradeValueEUR` | `cfg.perTradeAllocation \|\| 50` | ⚠️ Uses config default, not intent metadata |
| `totalExposureEUR` query | No `is_test_mode` filter, no `.limit()` override | 🔴 Mode mixing + truncation risk |
| Query error handling | Silent — defaults to 0 exposure on failure | 🔴 Fail-OPEN, not fail-closed |
| Comparison | `totalExposureEUR + tradeValueEUR > maxWalletExposureEUR` | Logic correct IF inputs are correct |
| Primary bypass | UD=OFF skips `detectConflicts()` entirely | 🔴 CONFIRMED ROOT CAUSE |
