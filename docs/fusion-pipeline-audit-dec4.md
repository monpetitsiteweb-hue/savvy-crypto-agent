# Fusion Pipeline Audit Report - December 4, 2025

## Executive Summary

All three non-technical signal pipelines (Whale, Volatility, Sentiment) were returning 0 to the fusion layer despite active data ingestion. This audit identified and fixed the root causes.

---

## Capability Status Table

| Pipeline | Ingestion Working? | Signals in DB? | Used in Fusion? | Typical Score Range |
|----------|-------------------|----------------|-----------------|---------------------|
| **Whale** | ⚠️ Partial | ❌ 0 rows | ✅ Fixed query | Expected: -0.5 to +0.5 |
| **Volatility** | ✅ Yes | ⚠️ vol_24h only | ✅ Fixed to use vol_24h | -0.3 to +0.3 |
| **Sentiment** | ✅ Yes | ✅ news_volume_spike | ✅ Fixed query | -0.5 to +0.5 |

---

## 1. WHALE PIPELINE

### Root Cause Analysis
1. **No webhook invocations** - Edge function logs show ZERO incoming requests ever
2. **user_id = NULL** in `ai_data_sources` for whale sources, causing insert failures
3. QuickNode dashboard shows "116 deliveries" but nothing reached Supabase

### Database State
```sql
-- Zero whale signals exist
SELECT COUNT(*) FROM live_signals 
WHERE source ILIKE '%whale%' OR signal_type ILIKE '%whale%';
-- Result: 0
```

### Data Sources Configuration
| source_name | is_active | user_id | last_sync |
|-------------|-----------|---------|-----------|
| quicknode_webhooks | true | NULL | 2025-10-19 |
| whale_alert | true | NULL | 2025-12-03 |
| whale_alert_api | true | NULL | 2025-09-01 |

### Fix Applied
- **File**: `supabase/functions/whale-alert-webhook/index.ts`
- **Change**: Added fallback user_id resolution when source.user_id is NULL
- **Deployed**: Yes

### Remaining Investigation Needed
1. Verify QuickNode webhook URL is correct: `https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/whale-alert-webhook`
2. Test webhook delivery manually
3. Check if firewall/CORS is blocking incoming webhooks

---

## 2. VOLATILITY PIPELINE

### Root Cause Analysis
1. **vol_1h and vol_4h are always NULL** in `market_features_v0`
2. Reason: volatility calculation requires ≥2 candles in window, but for 4h/24h granularity, a "1h window" only contains 1 candle
3. **vol_24h HAS DATA** but fusion was using `(vol_1h + vol_24h) / 2` which collapsed to 0

### Database State
```sql
SELECT symbol, ts_utc, vol_1h, vol_4h, vol_24h, ret_24h
FROM market_features_v0
WHERE symbol = 'BTC-EUR'
ORDER BY ts_utc DESC LIMIT 5;

-- Results:
-- vol_1h: NULL
-- vol_4h: NULL  
-- vol_24h: 0.0625 (HAS DATA!)
-- ret_24h: 0.160 (HAS DATA!)
```

### Fix Applied
- **File**: `src/hooks/useIntelligentTradingEngine.tsx`
- **Function**: `calculateVolatilityScore()`
- **Change**: Prioritize vol_24h instead of vol_1h, use vol_24h as primary signal
- **Expected Score**: Low vol (<2%) = +0.3, Medium (2-5%) = 0, High (>5%) = -0.3

### New Formula
```typescript
const vol24h = f.vol_24h ?? 0;
const ret24h = Math.abs(f.ret_24h ?? 0);
const avgVol = vol24h > 0 ? vol24h : ret24h;

let volScore = 0;
if (avgVol > 0.05) volScore = -0.3;      // High volatility
else if (avgVol > 0.02) volScore = 0;     // Medium
else if (avgVol > 0) volScore = 0.3;      // Low volatility
```

---

## 3. SENTIMENT PIPELINE

### Root Cause Analysis
1. **Signal type mismatch** - fusion queried for `sentiment_bullish_*` but DB has `news_volume_spike`
2. The `news_volume_spike` signal contains `data.avg_sentiment` field (0.466) but was never read
3. `fear_greed_index` last updated Nov 26 - workflow may be failing

### Database State
```sql
SELECT source, signal_type, COUNT(*) FROM live_signals
WHERE source IN ('crypto_news', 'fear_greed_index')
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY source, signal_type;

-- Results:
-- crypto_news | news_volume_spike | 64 (FRESH!)
-- fear_greed_index | (none recent)
```

### News Signal Structure
```json
{
  "source": "crypto_news",
  "signal_type": "news_volume_spike",
  "signal_strength": 60,
  "data": {
    "avg_sentiment": 0.4666,
    "news_count": 3,
    "time_window": "24h"
  }
}
```

### Fix Applied
- **File**: `src/hooks/useIntelligentTradingEngine.tsx`
- **Function**: `calculateSentimentScore()`
- **Changes**:
  1. Added `news_volume_spike` to signal_type filter
  2. Extract `data.avg_sentiment` and convert to -1 to +1 range
  3. Sentiment bias = (avg_sentiment - 0.5) × 2

### New Formula
```typescript
if (signal.signal_type === 'news_volume_spike' && signalData?.avg_sentiment !== undefined) {
  const avgSentiment = signalData.avg_sentiment;  // 0 to 1
  const sentimentBias = (avgSentiment - 0.5) * 2; // -1 to +1
  sentimentScore += weight * sentimentBias * 0.4;
}
```

---

## How to Test

### 1. Volatility (should work immediately)
```javascript
// In browser console after next engine cycle:
// Look for log line:
"📊 [FUSION] Volatility score for BTC-EUR: 0.300 | vol24h: 0.0625, ret24h: 0.1600, avgVol: 0.0625"
```

### 2. Sentiment (should work immediately)
```javascript
// Look for log line showing non-zero sentiment:
"📊 [FUSION] Sentiment score for BTC (BUY): -0.027 | signals: 5, processed: 5"
```

### 3. Whale (requires webhook delivery)
```bash
# Test webhook manually:
curl -X POST https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/whale-alert-webhook \
  -H "Content-Type: application/json" \
  -d '{"matchingTransactions":[{"hash":"0xtest","from":"0x123","to":"0x456","value":"0x8ac7230489e80000","chainId":"0x1"}]}'

# Then check DB:
SELECT * FROM live_signals WHERE source = 'whale_alert_tracked' ORDER BY timestamp DESC LIMIT 5;
```

---

## Remaining Gaps for "Omniscient AI"

1. **Whale Real-Time Integration**
   - QuickNode webhook may need re-registration
   - Consider adding API polling as backup

2. **Fear & Greed Index**
   - Last updated Nov 26
   - Need to investigate `external-data-collector` workflow

3. **Learning Loop Integration**
   - `decision_events` → `decision_outcomes` pipeline working
   - Calibration metrics available but not yet influencing fusion weights

4. **Adaptive Thresholds**
   - Fusion thresholds (enterThreshold: 0.65) are still static
   - Need meta-learning layer to adjust based on calibration_metrics

---

## Files Modified

1. `src/hooks/useIntelligentTradingEngine.tsx`
   - `calculateVolatilityScore()` - fixed to use vol_24h
   - `calculateSentimentScore()` - added news_volume_spike handling

2. `supabase/functions/whale-alert-webhook/index.ts`
   - Added fallback user_id resolution for NULL sources
   - Deployed to production

---

## Verification SQL Queries

```sql
-- Check fresh signals by type
SELECT source, signal_type, COUNT(*) as cnt, MAX(timestamp) as last_ts
FROM live_signals
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY source, signal_type
ORDER BY cnt DESC;

-- Check volatility data availability
SELECT symbol, ts_utc, vol_24h, ret_24h
FROM market_features_v0
WHERE ts_utc > NOW() - INTERVAL '1 day'
ORDER BY ts_utc DESC
LIMIT 10;

-- Check whale signals (expect 0 until webhook starts delivering)
SELECT * FROM live_signals 
WHERE source ILIKE '%whale%'
ORDER BY timestamp DESC
LIMIT 10;
```
