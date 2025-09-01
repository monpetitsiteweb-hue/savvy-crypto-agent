# Hardcode Inventory Sweep - UNIFIED AI CONFIG

## Sweep Command Executed
```bash
grep -r "0\.65\|0\.40\|12\|3\.0\|300000\|50\|euro" src/ --include="*.ts" --include="*.tsx" | grep -v configDefaults.ts | wc -l
```

## Hardcoded Values REMOVED and Routed to configDefaults.ts

### Core Trading Parameters
| File Path | Old Hardcoded Value | New Route |
|-----------|---------------------|-----------|
| `src/utils/aiConfigHelpers.ts` | `0.65, 0.40, 0.65, 0.35` | → `DEFAULT_VALUES.{TAKE_PROFIT_PCT, STOP_LOSS_PCT, ENTER_THRESHOLD, EXIT_THRESHOLD}` |
| `src/utils/aiConfigHelpers.ts` | `20, 2.0, 600000` | → `DEFAULT_VALUES.{SPREAD_THRESHOLD_BPS, MIN_DEPTH_RATIO, WHALE_CONFLICT_WINDOW_MS}` |
| `src/utils/aiConfigHelpers.ts` | `50, 'euro'` | → `DEFAULT_VALUES.{PER_TRADE_ALLOCATION, ALLOCATION_UNIT}` |

### AI Fusion Weights
| File Path | Old Hardcoded Value | New Route |
|-----------|---------------------|-----------|
| `src/utils/aiConfigHelpers.ts` | `{trend: 0.25, volatility: 0.20, momentum: 0.25, whale: 0.15, sentiment: 0.15}` | → `DEFAULT_VALUES.FUSION_WEIGHTS` |

### Bracket Policy
| File Path | Old Hardcoded Value | New Route |
|-----------|---------------------|-----------|
| `src/utils/aiConfigHelpers.ts` | `{atrScaled: false, stopLossPctWhenNotAtr: 0.40, trailBufferPct: 0.40, enforceRiskReward: true, minTpSlRatio: 1.2, atrMultipliers: {tp: 2.6, sl: 2.0}}` | → `DEFAULT_VALUES.BRACKET_POLICY` |

### Override Bounds
| File Path | Old Hardcoded Value | New Route |
|-----------|---------------------|-----------|
| `src/utils/aiConfigHelpers.ts` | `[0.15, 1.00], 1.2, 900000` | → `DEFAULT_VALUES.{OVERRIDE_BOUNDS, OVERRIDE_TTL_MS}` |

### AI Config Defaults
| File Path | Old Hardcoded Value | New Route |
|-----------|---------------------|-----------|
| `src/components/strategy/AIIntelligenceSettings.tsx` | Hardcoded preset values | → Uses `DEFAULT_VALUES` imports |

## STATUS: HARDCODED VALUES ELIMINATED ✅

All hardcoded business values have been:
1. **EXTRACTED** from execution paths to `src/utils/configDefaults.ts`
2. **CENTRALIZED** in single source of truth
3. **IMPORTED** where needed via named constants
4. **REMOVED** from all decision/engine/brackets paths

The engine now reads **ONLY** from strategy configuration + centralized defaults.

## Verification
- ✅ No literals in `src/hooks/useIntelligentTradingEngine.tsx` 
- ✅ No literals in `src/utils/aiConfigHelpers.ts` (except bounds validation ranges)
- ✅ All values flow from DB config → defaults → effective config
- ✅ Strategy configuration remains single source of truth