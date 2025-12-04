# Intelligent Trading Engine Architecture v2

## Overview

This document describes the current state of the Intelligent Trading Engine after the v2 refactor that fixed the BUY/SELL consistency issue.

## Core Architecture Principles

### 1. Fusion Layer = AI Brain (Discretionary Decisions)

The AI signal fusion layer controls:
- **BUY entries**: All buy decisions go through fusion evaluation
- **Discretionary exits**: Future feature for AI-driven "market looks bad" exits

The fusion layer calculates a composite score from multiple signal buckets:
- Trend (MA crosses, trend direction)
- Momentum (RSI, MACD)
- Volatility (ATR-based)
- Whale (large transaction detection)
- Sentiment (news/social signals)

### 2. Risk Layer = Protection (Hard Rules)

Hard risk rules NEVER go through fusion. These are non-negotiable protections:
- **TAKE_PROFIT**: When P&L >= TP threshold
- **STOP_LOSS**: When P&L <= SL threshold  
- **AUTO_CLOSE_TIME**: When position age >= timeout hours
- **TRAILING_STOP**: When price drops from peak by trailing %

**Fusion can NEVER block these exits.** This is a fundamental architecture decision.

### 3. Per-Lot Execution

All trades execute at the lot level:
- Engine computes pooled P&L per symbol (for TP/SL decisions)
- Coordinator splits SELL intents into per-lot orders
- Each closed lot = 1 SELL row in mock_trades with `original_trade_id`

## Decision Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Engine Cycle (60s interval)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              1. Manage Existing Positions                        │
│  - Calculate pooled P&L per symbol                              │
│  - Check TP/SL/timeout conditions                               │
│  - getSellDecision() returns reason: TAKE_PROFIT | STOP_LOSS | etc
└─────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┴──────────────────┐
           │                                      │
           ▼                                      ▼
┌─────────────────────┐              ┌─────────────────────────────┐
│ HARD RISK EXIT      │              │ NO SELL CONDITIONS MET      │
│ (TP/SL/timeout)     │              │ Continue to BUY evaluation  │
│                     │              │                             │
│ BYPASS FUSION       │              └─────────────────────────────┘
│ Execute immediately │
└─────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              2. Check BUY Opportunities                          │
│  - For each selected coin:                                       │
│    - Check exposure limits                                       │
│    - Check cooldown                                              │
│    - getBuySignal() checks: whale, news, social, technical, AI  │
└─────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┴──────────────────┐
           │                                      │
           ▼                                      ▼
┌─────────────────────┐              ┌─────────────────────────────┐
│ SIGNAL FOUND        │              │ NO SIGNAL FOUND             │
│                     │              │ No BUY executed             │
│ GO THROUGH FUSION   │              │                             │
│ (may approve/reject)│              └─────────────────────────────┘
└─────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              3. Execute via Coordinator                          │
│  - Emit intent to trading-decision-coordinator                   │
│  - Coordinator applies gates (cooldown, exposure, hold period)  │
│  - For SELLs: splits into per-lot orders                        │
│  - Inserts trade(s) into mock_trades                            │
└─────────────────────────────────────────────────────────────────┘
```

## Fusion Bypass Rules

| Trigger | Goes Through Fusion? | Reason |
|---------|---------------------|--------|
| TAKE_PROFIT | ❌ NO | Hard risk rule |
| STOP_LOSS | ❌ NO | Hard risk rule |
| AUTO_CLOSE_TIME | ❌ NO | Hard risk rule |
| TRAILING_STOP | ❌ NO | Hard risk rule |
| TECHNICAL_SIGNAL (BUY) | ✅ YES | Discretionary entry |
| WHALE_SIGNAL (BUY) | ✅ YES | Discretionary entry |
| NEWS_SENTIMENT_SIGNAL (BUY) | ✅ YES | Discretionary entry |
| debug_force_buy | ❌ NO | Explicit debug (manual only) |
| FORCED_DEBUG_TRADE | ❌ NO | Explicit debug (manual only) |

## Effective Configuration

Current default thresholds (from strategy config + code defaults):

```yaml
# Risk Rules (checked in getSellDecision)
takeProfitPercentage: 0.5%  # + 0.03% epsilon buffer = 0.53% effective
stopLossPercentage: 0.5%    # + 0.03% epsilon buffer = 0.53% effective
autoCloseAfterHours: 12     # Close positions after 12 hours

# Time Gates
minHoldPeriodMs: 5000       # 5 seconds minimum hold
cooldownBetweenOppositeActionsMs: 5000  # 5 seconds cooldown

# Fusion Thresholds (when fusion IS evaluated)
enterThreshold: 0.65        # BUY requires score >= 0.65
exitThreshold: 0.35         # Discretionary SELL requires score <= -0.35

# Fusion Weights
weights:
  trend: 0.25
  volatility: 0.10
  momentum: 0.30
  whale: 0.20
  sentiment: 0.15
```

## Signal Sources Status

| Source | Status | Notes |
|--------|--------|-------|
| live_signals (technical) | ⚠️ PARTIAL | Queries for bullish types but often returns 0 rows |
| live_signals (whale) | ⚠️ PARTIAL | Requires whale-alert integration to be running |
| live_signals (sentiment) | ⚠️ PARTIAL | Requires news collector to be running |
| external_market_data | ⚠️ PARTIAL | Depends on data source configuration |
| whale_signal_events | ⚠️ PARTIAL | Requires active whale monitoring |
| market_features_v0 | ✅ AVAILABLE | Technical indicators from features-refresh |

## Debug Commands

```javascript
// Force a debug BUY (bypasses fusion, for testing only)
window.__INTELLIGENT_FORCE_DEBUG_TRADE = true

// Suppress engine logs
window.__INTELLIGENT_SUPPRESS_LOGS = true

// Disable auto-run loop
window.__INTELLIGENT_DISABLE_AUTORUN = true

// Check debug history
window.__INTELLIGENT_DEBUG_HISTORY

// Check last emitted intent
window.__INTELLIGENT_DEBUG_LAST_INTENT
```

## What's Missing for "Omniscient AI Crypto Expert"

### Implemented ✅
- Per-lot tracking & P&L computation
- Pooled per-coin view for decisions
- Hybrid TP selective / SL full flush
- Manual SELL (lot + symbol) via coordinator
- Cooldown / min-hold logic
- Learning loop (decision_events → decision_outcomes)
- Calibration metrics & suggestions

### Partial ⚠️
- Signal fusion layer (queries exist but data often empty)
- Spread / liquidity / freshness gates (bypassed in test mode)
- Whale signal integration (infrastructure exists, needs data)

### Not Implemented ❌
- Adaptive thresholds / meta-learning
- Multi-source signal fusion with real-time data
- On-chain execution (only mock trades)
- Confidence-based position sizing
- Portfolio-level risk management

## Changelog

### v2 (Current)
- Fixed: TP/SL/timeout now ALWAYS bypass fusion
- Removed: TEST_ALWAYS_BUY automatic bypass (was causing inconsistent BUY/SELL behavior)
- Added: Clear documentation of fusion bypass rules
- Added: Explicit debug-only triggers for forced trades

### v1 (Previous)
- Initial implementation with TEST_ALWAYS_BUY bypass
- BUYs bypassed fusion, SELLs did not (inconsistent)
- TP/SL exits blocked by signal_too_weak
