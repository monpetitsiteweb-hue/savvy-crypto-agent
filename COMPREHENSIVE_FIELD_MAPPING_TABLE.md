# COMPREHENSIVE STRATEGY FIELD MAPPING TABLE

## ISSUE ANALYSIS

Based on the edge function logs and user reports, several commands are failing:

**WORKING COMMANDS:**
- "set Trailing Buy Percentage to 10%" ✅ - Works (field: `trailingBuyPercentage`)
- "enable specific coin" ✅ - Works (individual coin additions)

**FAILING COMMANDS:**
- "set Max Wallet Exposure to 80%" ❌ - Field name issue
- "add all available coins to my strategy" ❌ - Logic issue  
- "disable all notifications" ❌ - Multiple field update issue
- "set Take Profit Percentage to 1.5%" ❌ - Field name issue
- "set Max Active Coin to 10" ❌ - Field name issue
- "set max open position to 10" ❌ - Field name issue

## DETAILED FIELD MAPPING TABLE

| **UI Field Name** | **Actual Form Field** | **AI Command Examples** | **AI Field Names Used** | **Tooltip Description** | **Current Status** |
|------------------|----------------------|------------------------|------------------------|---------------------|------------------|
| **BASIC SETTINGS** |
| Strategy Name | `strategyName` | "Rename strategy to...", "Call it..." | `strategyName`, `StrategyName`, `name` | Strategy name for identification | ✅ Mapped |
| Risk Profile | `riskProfile` | "Make it more conservative", "Set to high risk" | `riskProfile`, `RiskProfile`, `risk` | Risk level (low/medium/high/custom) | ✅ Mapped |
| Max Wallet Exposure | `maxWalletExposure` | "Increase wallet exposure to 80%", "Use 50% of wallet" | `maxWalletExposure`, `MaxWalletExposure`, `walletexposure` | % of wallet that can be used | ✅ Mapped |
| Enable Live Trading | `enableLiveTrading` | "Enable live trading", "Go live" | `enableLiveTrading`, `EnableLiveTrading`, `livetrading` | Allow real money trading | ✅ Mapped |
| Enable Test Trading | `enableTestTrading` | "Enable test mode", "Switch to test" | `enableTestTrading`, `EnableTestTrading`, `testtrading` | Enable test mode trading | ✅ Mapped |
| **COINS AND AMOUNTS** |
| Selected Coins | `selectedCoins` | "Add BTC", "Include all coins", "Trade Ethereum" | `selectedCoins`, `SelectedCoins`, `coins` | Cryptocurrencies to trade | ✅ Mapped |
| Max Active Coins | `maxActiveCoins` | "Focus on 3 coins max", "Limit to 5 cryptos" | `maxActiveCoins`, `MaxActiveCoins` | Max coins to trade simultaneously | ✅ Mapped |
| Auto Coin Selection | `enableAutoCoinSelection` | "Auto-select best coins", "Let AI pick cryptos" | `enableAutoCoinSelection` | Let AI choose coins | ✅ Mapped |
| Per Trade Allocation | `perTradeAllocation` | "Use 100 euros per trade", "Risk 5% per position" | `perTradeAllocation`, `PerTradeAllocation`, `allocation` | Amount per trade | ✅ Mapped |
| Allocation Unit | `allocationUnit` | "Use euros", "Switch to percentage" | `allocationUnit` | Euro or percentage | ✅ Mapped |
| Buy Frequency | `buyFrequency` | "Buy daily", "Trade on signals only" | `buyFrequency` | How often to buy | ✅ Mapped |
| Buy Interval Minutes | `buyIntervalMinutes` | "Buy every hour", "Space trades 30 min apart" | `buyIntervalMinutes` | Minutes between buys | ✅ Mapped |
| Buy Cooldown Minutes | `buyCooldownMinutes` | "Wait 60 minutes between buys" | `buyCooldownMinutes` | Cooldown between buys | ✅ Mapped |
| **BUY/SELL SETTINGS** |
| Buy Order Type | `buyOrderType` | "Use market orders for buying" | `buyOrderType`, `BuyOrderType` | Market, limit, or trailing buy | ✅ Mapped |
| Sell Order Type | `sellOrderType` | "Use limit orders for selling" | `sellOrderType`, `SellOrderType` | Market, limit, trailing stop, auto close | ✅ Mapped |
| Take Profit Percentage | `takeProfitPercentage` | "Set take profit to 2%", "Target 1.5% gains" | `takeProfitPercentage`, `TakeProfitPercentage`, `takeprofit` | % gain to take profit | ✅ Mapped |
| Stop Loss Percentage | `stopLossPercentage` | "Set stop loss to 3%", "Limit losses to 2%" | `stopLossPercentage`, `StopLossPercentage`, `stoploss` | % loss to stop | ✅ Mapped |
| Trailing Stop Loss % | `trailingStopLossPercentage` | "Set trailing stop to 2%" | `trailingStopLossPercentage` | Trailing stop loss % | ✅ Mapped |
| Trailing Buy % | `trailingBuyPercentage` | "Set trailing buy to 1.5%" | `trailingBuyPercentage` | Trailing buy % | ✅ Mapped |
| Auto Close After Hours | `autoCloseAfterHours` | "Close positions after 24 hours" | `autoCloseAfterHours` | Auto close positions after X hours | ✅ Mapped |
| **POSITION MANAGEMENT** |
| Max Open Positions | `maxOpenPositions` | "Limit to 3 open positions", "Allow 5 positions" | `maxOpenPositions`, `MaxOpenPositions` | Max positions at once | ✅ Mapped |
| Daily Profit Target | `dailyProfitTarget` | "Target 1% daily gains", "Aim for 2% daily" | `dailyProfitTarget`, `DailyProfitTarget` | Daily profit goal | ✅ Mapped |
| Daily Loss Limit | `dailyLossLimit` | "Limit daily losses to 2%", "Stop at 1% loss" | `dailyLossLimit`, `DailyLossLimit` | Daily loss limit | ✅ Mapped |
| Trade Cooldown Minutes | `tradeCooldownMinutes` | "Wait 30 minutes between trades" | `tradeCooldownMinutes` | Minutes between trades | ✅ Mapped |
| **DCA & ADVANCED** |
| Enable DCA | `enableDCA` | "Enable DCA", "Use dollar cost averaging" | `enableDCA`, `EnableDCA`, `dca` | Enable dollar cost averaging | ✅ Mapped |
| DCA Interval Hours | `dcaIntervalHours` | "DCA every 12 hours", "Space DCA 24 hours" | `dcaIntervalHours` | Hours between DCA steps | ✅ Mapped |
| DCA Steps | `dcaSteps` | "Use 3 DCA steps", "Do 5 averaging steps" | `dcaSteps` | Number of DCA steps | ✅ Mapped |
| Backtesting Mode | `backtestingMode` | "Enable backtesting", "Test strategy on history" | `backtestingMode`, `BacktestingMode`, `backtest` | Enable backtesting | ✅ Mapped |
| **SHORTING** |
| Enable Shorting | `enableShorting` | "Enable shorting", "Allow short positions" | `enableShorting`, `EnableShorting`, `shorting` | Allow short selling | ✅ Mapped |
| Max Short Positions | `maxShortPositions` | "Limit to 2 short positions" | `maxShortPositions` | Max short positions | ✅ Mapped |
| Shorting Min Profit % | `shortingMinProfitPercentage` | "Minimum 1.5% profit on shorts" | `shortingMinProfitPercentage` | Min profit % for shorts | ✅ Mapped |
| Auto Close Shorts | `autoCloseShorts` | "Auto close short positions" | `autoCloseShorts` | Auto close short positions | ✅ Mapped |
| **NOTIFICATIONS** |
| Notify On Trade | `notifyOnTrade` | "Send trade notifications", "Alert on trades" | `notifyOnTrade`, `NotifyOnTrade` | Notify on trades | ✅ Mapped |
| Notify On Error | `notifyOnError` | "Send error alerts", "Notify on failures" | `notifyOnError`, `NotifyOnError` | Notify on errors | ✅ Mapped |
| Notify On Targets | `notifyOnTargets` | "Alert when targets hit", "Notify on goals" | `notifyOnTargets`, `NotifyOnTargets` | Notify on target hits | ✅ Mapped |
| **ADVANCED SETTINGS** |
| Enable Stop Loss Timeout | `enableStopLossTimeout` | "Remove stop loss after timeout" | `enableStopLossTimeout` | Cancel stop loss after timeout | ✅ Mapped |
| Stop Loss Timeout Minutes | `stopLossTimeoutMinutes` | "Timeout after 2 hours" | `stopLossTimeoutMinutes` | Minutes before timeout | ✅ Mapped |
| Use Trailing Stop Only | `useTrailingStopOnly` | "Only use trailing stops" | `useTrailingStopOnly` | Disable fixed stop loss | ✅ Mapped |
| Reset Stop Loss After Fail | `resetStopLossAfterFail` | "Reset stop loss if it fails" | `resetStopLossAfterFail` | Reset stop loss after failure | ✅ Mapped |
| Category | `category` | "Set category to scalping" | `category` | Strategy category | ✅ Mapped |
| Tags | `tags` | "Add automated tag" | `tags` | Strategy tags | ✅ Mapped |

## AI INTELLIGENCE CONFIG FIELDS (Nested under aiIntelligenceConfig)

| **UI Field Name** | **Actual Nested Field** | **AI Command Examples** | **AI Field Names Used** | **Tooltip Description** | **Current Status** |
|------------------|------------------------|------------------------|------------------------|---------------------|------------------|
| Enable AI Override | `enableAIOverride` | "Give AI more control", "Enable AI override" | `AIOverrideEnabled`, `enableAIOverride` | Allow AI to override rules | ✅ Mapped |
| AI Autonomy Level | `aiAutonomyLevel` | "Give you more autonomy", "Set autonomy to 100%" | `AIAutonomyLevel`, `aiAutonomyLevel`, `autonomylevel` | AI freedom level (0-100) | ✅ Mapped |
| AI Confidence Threshold | `aiConfidenceThreshold` | "Be more confident", "Set confidence to 80%" | `AIConfidenceThreshold`, `aiConfidenceThreshold` | Min confidence to act | ✅ Mapped |
| Enable Pattern Recognition | `enablePatternRecognition` | "Use pattern recognition", "Analyze trends" | `enablePatternRecognition`, `patternrecognition` | Enable pattern analysis | ✅ Mapped |
| Pattern Lookback Hours | `patternLookbackHours` | "Look back 7 days", "Use 2 weeks data" | `patternLookbackHours`, `lookbackhours` | Hours to analyze patterns | ✅ Mapped |
| Cross Asset Correlation | `crossAssetCorrelation` | "Check BTC vs altcoin correlation" | `crossAssetCorrelation` | Analyze asset correlations | ✅ Mapped |
| Market Structure Analysis | `marketStructureAnalysis` | "Check market depth", "Monitor liquidity" | `marketStructureAnalysis` | Analyze market structure | ✅ Mapped |
| Enable External Signals | `enableExternalSignals` | "Use whale alerts", "Monitor news signals" | `enableExternalSignals`, `externalsignals` | Process external signals | ✅ Mapped |
| Whale Activity Weight | `whaleActivityWeight` | "Focus on whale movements", "Weight whales 30%" | `whaleActivityWeight` | Weight for whale signals | ✅ Mapped |
| Sentiment Weight | `sentimentWeight` | "Track market sentiment", "Use sentiment 25%" | `sentimentWeight` | Weight for sentiment | ✅ Mapped |
| News Impact Weight | `newsImpactWeight` | "React to breaking news", "News weight 40%" | `newsImpactWeight` | Weight for news | ✅ Mapped |
| Social Signals Weight | `socialSignalsWeight` | "Monitor social trends", "Social weight 20%" | `socialSignalsWeight` | Weight for social signals | ✅ Mapped |
| Decision Mode | `decisionMode` | "Be more conservative/aggressive" | `decisionMode` | AI decision style | ✅ Mapped |
| Escalation Threshold | `escalationThreshold` | "Ask before big decisions", "Handle more yourself" | `escalationThreshold` | When to escalate vs act | ✅ Mapped |
| Risk Override Allowed | `riskOverrideAllowed` | "Override risk when needed", "Strict risk only" | `riskOverrideAllowed` | Allow risk override | ✅ Mapped |
| Enable Learning | `enableLearning` | "Learn from performance", "Adapt over time" | `enableLearning`, `learning` | Enable AI learning | ✅ Mapped |
| Adapt To Performance | `adaptToPerformance` | "Adjust based on results" | `adaptToPerformance` | Adapt to performance | ✅ Mapped |
| Learning Rate | `learningRate` | "Learn faster", "Slow down learning" | `learningRate` | Learning speed | ✅ Mapped |
| Explain Decisions | `explainDecisions` | "Explain your decisions", "Tell me why" | `explainDecisions` | Explain AI decisions | ✅ Mapped |
| Alert On Anomalies | `alertOnAnomalies` | "Alert on unusual patterns" | `alertOnAnomalies` | Alert on anomalies | ✅ Mapped |
| Alert On Overrides | `alertOnOverrides` | "Tell me when you override" | `alertOnOverrides` | Alert on overrides | ✅ Mapped |
| Custom Instructions | `customInstructions` | "Follow these instructions..." | `customInstructions` | Custom AI instructions | ✅ Mapped |

## DUPLICATE FIELD ANALYSIS

**POTENTIAL CONFLICTS IDENTIFIED:**

1. **AI Autonomy Level Duplication:**
   - Root Level: `aiAutonomyLevel` (appears in main config)
   - AI Intelligence Config: `aiAutonomyLevel` (nested under aiIntelligenceConfig)
   - **CONFLICT:** Both exist in the same configuration object

2. **Notification Fields:**
   - Multiple notification fields may need to be updated together for "disable all notifications"
   - Need to handle bulk notification changes

3. **Missing "All Coins" Logic:**
   - When user says "add all available coins", need to map to full COINBASE_COINS array
   - Current logic may not be handling "all" keyword properly

## ROOT CAUSE ANALYSIS OF FAILURES

1. **Field Mapping Issues:**
   - AI correctly maps field names but may have case sensitivity issues
   - Some commands work (trailing buy) others don't (max wallet exposure) - inconsistent behavior

2. **Bulk Operation Issues:**
   - "All coins" and "all notifications" commands require special logic
   - Need to handle array operations and multiple field updates

3. **Value Type Mismatches:**
   - Percentage values may need proper numeric conversion
   - Boolean vs string type issues

## RECOMMENDATIONS

1. **Add Special Handlers for Bulk Operations:**
   - "all coins" → set selectedCoins to full COINBASE_COINS array
   - "disable all notifications" → set notifyOnTrade, notifyOnError, notifyOnTargets to false

2. **Fix Duplicate Field Issue:**
   - Remove or consolidate duplicate aiAutonomyLevel fields
   - Ensure only one source of truth for each setting

3. **Add Debug Logging:**
   - Log exact field mappings and values being set
   - Verify config updates are properly saved to database

4. **Test Each Failing Command:**
   - Systematically test each reported failure
   - Verify mapping logic for percentage and numeric fields