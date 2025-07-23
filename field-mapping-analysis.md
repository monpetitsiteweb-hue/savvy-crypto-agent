# COMPREHENSIVE STRATEGY FIELD MAPPING ANALYSIS

## ISSUE SUMMARY
The AI assistant was saying it made changes but they weren't reflected in the UI because of field name mismatches between:
1. UI field names in the strategy configuration
2. AI agent field names when making changes
3. Tooltip descriptions and examples

## ALL STRATEGY FIELDS WITH TOOLTIPS AND AI MAPPINGS

### BASIC SETTINGS

| UI Field Name | Tooltip Description | AI Command Examples | AI Field Names Used | Status |
|---------------|-------------------|-------------------|-------------------|---------|
| `strategyName` | Strategy name for identification | "Rename strategy to...", "Call it..." | `strategyName`, `StrategyName`, `name` | ✅ Fixed |
| `riskProfile` | Risk level (low/medium/high/custom) | "Make it more conservative", "Set to high risk" | `riskProfile`, `RiskProfile`, `risk` | ✅ Fixed |
| `maxWalletExposure` | % of wallet that can be used | "Increase wallet exposure to 80%", "Use 50% of wallet" | `maxWalletExposure`, `MaxWalletExposure`, `walletexposure` | ✅ Fixed |
| `enableLiveTrading` | Allow real money trading | "Enable live trading", "Go live" | `enableLiveTrading`, `EnableLiveTrading`, `livetrading` | ✅ Fixed |
| `enableTestTrading` | Enable test mode trading | "Enable test mode", "Switch to test" | `enableTestTrading`, `EnableTestTrading`, `testtrading` | ✅ Fixed |

### COINS AND AMOUNTS

| UI Field Name | Tooltip Description | AI Command Examples | AI Field Names Used | Status |
|---------------|-------------------|-------------------|-------------------|---------|
| `selectedCoins` | Cryptocurrencies to trade | "Add BTC", "Include all coins", "Trade Ethereum" | `selectedCoins`, `SelectedCoins`, `coins` | ✅ Fixed |
| `maxActiveCoins` | Max coins to trade simultaneously | "Focus on 3 coins max", "Limit to 5 cryptos" | `maxActiveCoins`, `MaxActiveCoins` | ✅ Fixed |
| `enableAutoCoinSelection` | Let AI choose coins | "Auto-select best coins", "Let AI pick cryptos" | `enableAutoCoinSelection` | ❌ Missing mapping |
| `perTradeAllocation` | Amount per trade | "Use 100 euros per trade", "Risk 5% per position" | `perTradeAllocation`, `PerTradeAllocation`, `allocation` | ✅ Fixed |
| `allocationUnit` | Euro or percentage | "Use euros", "Switch to percentage" | `allocationUnit` | ❌ Missing mapping |
| `buyFrequency` | How often to buy | "Buy daily", "Trade on signals only" | `buyFrequency` | ❌ Missing mapping |
| `buyIntervalMinutes` | Minutes between buys | "Buy every hour", "Space trades 30 min apart" | `buyIntervalMinutes` | ❌ Missing mapping |
| `buyCooldownMinutes` | Cooldown between buys | "Wait 60 minutes between buys" | `buyCooldownMinutes` | ❌ Missing mapping |

### BUY/SELL SETTINGS

| UI Field Name | Tooltip Description | AI Command Examples | AI Field Names Used | Status |
|---------------|-------------------|-------------------|-------------------|---------|
| `buyOrderType` | Market, limit, or trailing buy | "Use market orders for buying" | `buyOrderType`, `BuyOrderType` | ✅ Fixed |
| `sellOrderType` | Market, limit, trailing stop, auto close | "Use limit orders for selling" | `sellOrderType`, `SellOrderType` | ✅ Fixed |
| `takeProfitPercentage` | % gain to take profit | "Set take profit to 2%", "Target 1.5% gains" | `takeProfitPercentage`, `TakeProfitPercentage`, `takeprofit` | ✅ Fixed |
| `stopLossPercentage` | % loss to stop | "Set stop loss to 3%", "Limit losses to 2%" | `stopLossPercentage`, `StopLossPercentage`, `stoploss` | ✅ Fixed |
| `trailingStopLossPercentage` | Trailing stop loss % | "Set trailing stop to 2%" | `trailingStopLossPercentage` | ❌ Missing mapping |
| `trailingBuyPercentage` | Trailing buy % | "Set trailing buy to 1.5%" | `trailingBuyPercentage` | ❌ Missing mapping |
| `autoCloseAfterHours` | Auto close positions after X hours | "Close positions after 24 hours" | `autoCloseAfterHours` | ❌ Missing mapping |

### POSITION MANAGEMENT

| UI Field Name | Tooltip Description | AI Command Examples | AI Field Names Used | Status |
|---------------|-------------------|-------------------|-------------------|---------|
| `maxOpenPositions` | Max positions at once | "Limit to 3 open positions", "Allow 5 positions" | `maxOpenPositions`, `MaxOpenPositions` | ✅ Fixed |
| `dailyProfitTarget` | Daily profit goal | "Target 1% daily gains", "Aim for 2% daily" | `dailyProfitTarget`, `DailyProfitTarget` | ✅ Fixed |
| `dailyLossLimit` | Daily loss limit | "Limit daily losses to 2%", "Stop at 1% loss" | `dailyLossLimit`, `DailyLossLimit` | ✅ Fixed |
| `tradeCooldownMinutes` | Minutes between trades | "Wait 30 minutes between trades" | `tradeCooldownMinutes` | ❌ Missing mapping |

### DCA & ADVANCED

| UI Field Name | Tooltip Description | AI Command Examples | AI Field Names Used | Status |
|---------------|-------------------|-------------------|-------------------|---------|
| `enableDCA` | Enable dollar cost averaging | "Enable DCA", "Use dollar cost averaging" | `enableDCA`, `EnableDCA`, `dca` | ✅ Fixed |
| `dcaIntervalHours` | Hours between DCA steps | "DCA every 12 hours", "Space DCA 24 hours" | `dcaIntervalHours` | ❌ Missing mapping |
| `dcaSteps` | Number of DCA steps | "Use 3 DCA steps", "Do 5 averaging steps" | `dcaSteps` | ❌ Missing mapping |
| `backtestingMode` | Enable backtesting | "Enable backtesting", "Test strategy on history" | `backtestingMode`, `BacktestingMode`, `backtest` | ✅ Fixed |

### SHORTING

| UI Field Name | Tooltip Description | AI Command Examples | AI Field Names Used | Status |
|---------------|-------------------|-------------------|-------------------|---------|
| `enableShorting` | Allow short selling | "Enable shorting", "Allow short positions" | `enableShorting`, `EnableShorting`, `shorting` | ✅ Fixed |
| `maxShortPositions` | Max short positions | "Limit to 2 short positions" | `maxShortPositions` | ❌ Missing mapping |
| `shortingMinProfitPercentage` | Min profit % for shorts | "Minimum 1.5% profit on shorts" | `shortingMinProfitPercentage` | ❌ Missing mapping |
| `autoCloseShorts` | Auto close short positions | "Auto close short positions" | `autoCloseShorts` | ❌ Missing mapping |

### NOTIFICATIONS

| UI Field Name | Tooltip Description | AI Command Examples | AI Field Names Used | Status |
|---------------|-------------------|-------------------|-------------------|---------|
| `notifyOnTrade` | Notify on trades | "Send trade notifications", "Alert on trades" | `notifyOnTrade`, `NotifyOnTrade` | ✅ Fixed |
| `notifyOnError` | Notify on errors | "Send error alerts", "Notify on failures" | `notifyOnError`, `NotifyOnError` | ✅ Fixed |
| `notifyOnTargets` | Notify on target hits | "Alert when targets hit", "Notify on goals" | `notifyOnTargets`, `NotifyOnTargets` | ✅ Fixed |

### AI INTELLIGENCE CONFIG (Nested under aiIntelligenceConfig)

| UI Field Name | Tooltip Description | AI Command Examples | AI Field Names Used | Status |
|---------------|-------------------|-------------------|-------------------|---------|
| `enableAIOverride` | Allow AI to override rules | "Give AI more control", "Enable AI override" | `AIOverrideEnabled`, `enableAIOverride` | ✅ Fixed |
| `aiAutonomyLevel` | AI freedom level (0-100) | "Give you more autonomy", "Set autonomy to 100%" | `AIAutonomyLevel`, `aiAutonomyLevel`, `autonomylevel` | ✅ Fixed |
| `aiConfidenceThreshold` | Min confidence to act | "Be more confident", "Set confidence to 80%" | `AIConfidenceThreshold`, `aiConfidenceThreshold` | ✅ Fixed |
| `enablePatternRecognition` | Enable pattern analysis | "Use pattern recognition", "Analyze trends" | `enablePatternRecognition`, `patternrecognition` | ✅ Fixed |
| `patternLookbackHours` | Hours to analyze patterns | "Look back 7 days", "Use 2 weeks data" | `patternLookbackHours`, `lookbackhours` | ✅ Fixed |
| `crossAssetCorrelation` | Analyze asset correlations | "Check BTC vs altcoin correlation" | `crossAssetCorrelation` | ✅ Fixed |
| `marketStructureAnalysis` | Analyze market structure | "Check market depth", "Monitor liquidity" | `marketStructureAnalysis` | ✅ Fixed |
| `enableExternalSignals` | Process external signals | "Use whale alerts", "Monitor news signals" | `enableExternalSignals`, `externalsignals` | ✅ Fixed |
| `whaleActivityWeight` | Weight for whale signals | "Focus on whale movements", "Weight whales 30%" | `whaleActivityWeight` | ✅ Fixed |
| `sentimentWeight` | Weight for sentiment | "Track market sentiment", "Use sentiment 25%" | `sentimentWeight` | ✅ Fixed |
| `newsImpactWeight` | Weight for news | "React to breaking news", "News weight 40%" | `newsImpactWeight` | ✅ Fixed |
| `socialSignalsWeight` | Weight for social signals | "Monitor social trends", "Social weight 20%" | `socialSignalsWeight` | ✅ Fixed |
| `decisionMode` | AI decision style | "Be more conservative/aggressive" | `decisionMode` | ✅ Fixed |
| `escalationThreshold` | When to escalate vs act | "Ask before big decisions", "Handle more yourself" | `escalationThreshold` | ✅ Fixed |
| `riskOverrideAllowed` | Allow risk override | "Override risk when needed", "Strict risk only" | `riskOverrideAllowed` | ✅ Fixed |
| `enableLearning` | Enable AI learning | "Learn from performance", "Adapt over time" | `enableLearning`, `learning` | ✅ Fixed |
| `adaptToPerformance` | Adapt to performance | "Adjust based on results" | `adaptToPerformance` | ✅ Fixed |
| `learningRate` | Learning speed | "Learn faster", "Slow down learning" | `learningRate` | ✅ Fixed |
| `explainDecisions` | Explain AI decisions | "Explain your decisions", "Tell me why" | `explainDecisions` | ✅ Fixed |
| `alertOnAnomalies` | Alert on anomalies | "Alert on unusual patterns" | `alertOnAnomalies` | ✅ Fixed |
| `alertOnOverrides` | Alert on overrides | "Tell me when you override" | `alertOnOverrides` | ✅ Fixed |
| `customInstructions` | Custom AI instructions | "Follow these instructions..." | `customInstructions` | ✅ Fixed |

## MISSING MAPPINGS IDENTIFIED

The following fields have NO mapping in the AI assistant and need to be added:

1. `enableAutoCoinSelection`
2. `allocationUnit` 
3. `buyFrequency`
4. `buyIntervalMinutes`
5. `buyCooldownMinutes`
6. `trailingStopLossPercentage`
7. `trailingBuyPercentage`
8. `autoCloseAfterHours`
9. `tradeCooldownMinutes`
10. `dcaIntervalHours`
11. `dcaSteps`
12. `maxShortPositions`
13. `shortingMinProfitPercentage`
14. `autoCloseShorts`
15. `enableStopLossTimeout`
16. `stopLossTimeoutMinutes`
17. `useTrailingStopOnly`
18. `resetStopLossAfterFail`
19. `category`
20. `tags`
21. `notes`

## CONCLUSION

The AI mapping is incomplete - only about 50% of strategy fields are properly mapped. Need to add all missing fields to the AI assistant's mapping logic.