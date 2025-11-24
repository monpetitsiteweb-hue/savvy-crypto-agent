# Signal Ingestion Documentation

## Overview
This document describes how external signals are ingested and stored in the system for use by the trading engine.

## Primary Table: `live_signals`

### Schema
- **id**: uuid (PK)
- **source_id**: uuid (FK to ai_data_sources)
- **user_id**: uuid
- **timestamp**: timestamptz
- **symbol**: text (e.g., "BTC", "ETH", "ALL" for market-wide)
- **signal_type**: text (the specific signal identifier)
- **signal_strength**: numeric (typically 0-100, but varies by provider)
- **source**: text (provider name)
- **data**: jsonb (additional signal-specific data)
- **processed**: boolean
- **created_at**: timestamptz

## Signal Providers

### 1. Technical Analysis (technical-signal-generator)
**Source**: `technical_analysis`
**Signal Types**:
- `ma_cross_bullish`: Moving average bullish crossover
- `ma_cross_bearish`: Moving average bearish crossover
- `rsi_oversold_bullish`: RSI indicates oversold condition (bullish)
- `rsi_overbought_bearish`: RSI indicates overbought condition (bearish)
- `volume_spike`: Unusual volume detected

**Signal Strength**: 0-100 scale
- 90-100: Strong signal
- 70-89: Moderate signal
- 50-69: Weak signal

**Data JSON**: Contains technical indicator values (ma_short, ma_long, rsi, volume_ratio)

### 2. Fear & Greed Index (external-data-collector)
**Source**: `fear_greed_index`
**Signal Types**:
- `fear_index_extreme`: Fear index < 20 (extreme fear, potentially bullish)
- `fear_index_moderate`: Fear index 20-45 (moderate fear)
- `greed_index_moderate`: Greed index 55-80 (moderate greed)
- `greed_index_extreme`: Greed index > 80 (extreme greed, potentially bearish)

**Signal Strength**: Direct mapping from index value (0-100)

**Data JSON**: Contains `value` (fear/greed index), `value_classification` (e.g., "Extreme Fear")

### 3. Crypto News (crypto-news-collector)
**Source**: `crypto_news`
**Signal Types**:
- `sentiment_bullish_strong`: Very positive news sentiment
- `sentiment_bearish_strong`: Very negative news sentiment
- `sentiment_bullish_moderate`: Moderately positive news
- `sentiment_bearish_moderate`: Moderately negative news
- `news_volume_high`: High volume of news articles
- `news_volume_spike`: Sudden spike in news volume
- `sentiment_mixed_bullish`: Mixed sentiment leaning bullish

**Signal Strength**: 0-100 based on sentiment score and news volume

**Data JSON**: Contains `headline`, `sentiment_score`, `article_count`, `sentiment_summary`

### 4. Whale Alert (whale-alert-webhook)
**Source**: `whale_alert`
**Signal Types**:
- `whale_movement`: Large transaction detected
- `whale_large_movement`: Very large transaction (>100 ETH equivalent)

**Signal Strength**: Proportional to transaction size
- Large movements (>100 ETH): 90-100
- Medium movements (10-100 ETH): 60-89
- Small movements (<10 ETH): 30-59

**Data JSON**: Contains `from`, `to`, `amount`, `amount_usd`, `transaction_hash`, `blockchain`

### 5. EODHD (eodhd-collector)
**Source**: `eodhd`
**Signal Types**:
- `intraday_volume_spike`: Intraday volume significantly above average
- Various fundamental signals (to be documented as implemented)

**Signal Strength**: 0-100 based on deviation from historical averages

**Data JSON**: Contains fundamental data, price history context

### 6. BigQuery (bigquery-signal-generator)
**Source**: `bigquery`
**Signal Types**:
- `historical_volume_surge`: Volume surge based on historical patterns
- `historical_resistance_test`: Price testing historical resistance
- `historical_support_test`: Price testing historical support

**Signal Strength**: 0-100 based on historical pattern strength

**Data JSON**: Contains historical context, pattern details, confidence metrics

## Signal Strength Normalization

Signals are normalized to a consistent 0-1 scale for fusion:
- 0.0-0.3: Weak signal
- 0.3-0.6: Moderate signal
- 0.6-0.8: Strong signal
- 0.8-1.0: Very strong signal

## Current Limitations

1. **Not Used in Coordinator**: Most signals are ingested but not yet integrated into trading decisions
2. **No Automatic Cleanup**: Old signals accumulate (future: implement TTL)
3. **Symbol Matching**: Signals for "ALL" (market-wide) need special handling
4. **No Deduplication**: Same signal can be generated multiple times
5. **No Calibration**: Signal effectiveness not yet measured against realized outcomes
