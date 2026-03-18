# PHASE 0 BASELINE METRICS — 2026-03-18 (Pre-Deployment)
## Window: 7 days

### 1. Guard Distribution (decision_events, all sides)
| Reason | Count |
|---|---|
| DEFER:TAKE_PROFIT | 75 |
| no_conflicts_detected: signal_confirmed_fusion_1.000 | 61 |
| DEFER:direct_execution_failed | 59 |
| fusion_below_threshold: backend_entry_evaluation | 53 |
| DEFER:SELL_TRAILING_RUNNER | 37 |
| DEFER:STOP_LOSS | 31 |
| DEFER:Guards tripped: exposureLimitExceeded | 28 |
| no_conflicts_detected: backend_entry_evaluation | 27 |
| max_active_coins_reached: signal_confirmed_fusion_1.000 | 23 |
| DEFER:Guards tripped: signalAlignmentFailed | 18 |
| no_conflicts_detected: signal_confirmed_fusion_0.950_age_adj_-0.05 | 16 |
| blocked_by_signal_alignment: signal_confirmed_fusion_1.000 | 4 |

### 2. SELL Success Rate
| Sells (7d) | With PnL | 
|---|---|
| 2 | 2 |

### 3. Execution Failures
| direct_execution_failed (7d) | 0 (in decision_events where reason exactly matches) |

Note: 59 DEFER:direct_execution_failed events exist — these are the DB-level position_already_open rejections.

### 4. BUY Trades Per Symbol (7d)
| Symbol | Count |
|---|---|
| ADA | 2 |
| AVAX | 2 |
| BTC | 1 |
| ETH | 1 |
| SOL | 1 |
| XRP | 1 |

### 5. Key Ratios
- Total guard-passed BUYs reaching coordinator: ~61 + 27 + 16 + 5 + 6 = ~115
- Actual BUY trades: 8
- DEFER:direct_execution_failed: 59 (≈51% of passed BUYs → DB unique index rejections)
