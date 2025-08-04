# COMPREHENSIVE FIELD MAPPING TABLE
## Complete Cross-System Field Analysis

| **UI Field Name** | **UI Property** | **Expected Type** | **DB Path** | **AI Assistant Key** | **AI Mapped** | **Tooltip Key** | **Status** | **Issues Found** |
|-------------------|-----------------|-------------------|-------------|---------------------|---------------|-----------------|------------|------------------|
| **BASIC STRATEGY** | | | | | | | | |
| Strategy Name | strategyName | string | strategy_name | ❌ NOT_MAPPED | No | "Strategy Name" | BROKEN | No AI mapping |
| Notes/Description | notes | string | description | ❌ NOT_MAPPED | No | "Notes" | BROKEN | No AI mapping |
| Risk Profile | riskProfile | enum | configuration.riskProfile | ❌ NOT_MAPPED | No | "Risk Profile" | BROKEN | No AI mapping |
| Max Wallet Exposure | maxWalletExposure | number | configuration.maxWalletExposure | ✅ maxWalletExposure | Yes | "Max Wallet Exposure" | ⚠️ PARTIAL | Wrong DB write path |
| Enable Live Trading | enableLiveTrading | boolean | configuration.enableLiveTrading | ❌ NOT_MAPPED | No | "Enable Live Trading" | BROKEN | No AI mapping |
| Enable Test Trading | enableTestTrading | boolean | configuration.enableTestTrading | ✅ enableTestTrading | Yes | "Enable Test Trading" | OK | Working |
| Category | category | string | configuration.category | ❌ NOT_MAPPED | No | "Category" | BROKEN | No AI mapping |
| Tags | tags | array | configuration.tags | ✅ tags | Yes | "Tags" | OK | Working |
| **COINS & AMOUNTS** | | | | | | | | |
| Selected Coins | selectedCoins | array | configuration.selectedCoins | ✅ selectedCoins | Yes | "Selected Coins" | ⚠️ CRITICAL | STRING vs ARRAY mismatch |
| Max Active Coins | maxActiveCoins | number | configuration.maxActiveCoins | ✅ maxActiveCoins | Yes | "Max Active Coins" | OK | Working |
| Auto Coin Selection | enableAutoCoinSelection | boolean | configuration.enableAutoCoinSelection | ❌ NOT_MAPPED | No | "Auto Coin Selection" | BROKEN | No AI mapping |
| Per Trade Allocation | perTradeAllocation | number | configuration.perTradeAllocation | ✅ perTradeAllocation | Yes | "Amount Per Trade" | OK | Working |
| Allocation Unit | allocationUnit | enum | configuration.allocationUnit | ❌ NOT_MAPPED | No | "Allocation Unit" | BROKEN | No AI mapping |
| **BUY SETTINGS** | | | | | | | | |
| Buy Order Type | buyOrderType | enum | configuration.buyOrderType | ✅ buyOrderType | Yes | "Buy Order Type" | OK | Working |
| Trailing Buy % | trailingBuyPercentage | number | configuration.trailingBuyPercentage | ❌ NOT_MAPPED | No | "Trailing Buy %" | BROKEN | No AI mapping |
| Buy Frequency | buyFrequency | enum | configuration.buyFrequency | ❌ NOT_MAPPED | No | "Buy Frequency" | BROKEN | No AI mapping |
| Buy Interval Minutes | buyIntervalMinutes | number | configuration.buyIntervalMinutes | ❌ NOT_MAPPED | No | "Buy Interval" | BROKEN | No AI mapping |
| Buy Cooldown Minutes | buyCooldownMinutes | number | configuration.buyCooldownMinutes | ❌ NOT_MAPPED | No | "Buy Cooldown" | BROKEN | No AI mapping |
| **SELL SETTINGS** | | | | | | | | |
| Sell Order Type | sellOrderType | enum | configuration.sellOrderType | ✅ sellOrderType | Yes | "Sell Order Type" | OK | Working |
| Take Profit % | takeProfitPercentage | number | configuration.takeProfitPercentage | ✅ takeProfitPercentage | Yes | "Take Profit %" | OK | Working |
| Stop Loss % | stopLossPercentage | number | configuration.stopLossPercentage | ✅ stopLossPercentage | Yes | "Stop Loss %" | OK | Working |
| Trailing Stop Loss % | trailingStopLossPercentage | number | configuration.trailingStopLossPercentage | ❌ NOT_MAPPED | No | "Trailing Stop %" | BROKEN | No AI mapping |
| Auto Close After Hours | autoCloseAfterHours | number | configuration.autoCloseAfterHours | ❌ NOT_MAPPED | No | "Auto Close Hours" | BROKEN | No AI mapping |
| Max Open Positions | maxOpenPositions | number | configuration.maxOpenPositions | ❌ NOT_MAPPED | No | "Max Positions" | BROKEN | No AI mapping |
| Trade Cooldown Minutes | tradeCooldownMinutes | number | configuration.tradeCooldownMinutes | ❌ NOT_MAPPED | No | "Trade Cooldown" | BROKEN | No AI mapping |
| Use Trailing Stop Only | useTrailingStopOnly | boolean | configuration.useTrailingStopOnly | ❌ NOT_MAPPED | No | "Trailing Only" | BROKEN | No AI mapping |
| Enable Stop Loss Timeout | enableStopLossTimeout | boolean | configuration.enableStopLossTimeout | ❌ NOT_MAPPED | No | "Stop Loss Timeout" | BROKEN | No AI mapping |
| Stop Loss Timeout Minutes | stopLossTimeoutMinutes | number | configuration.stopLossTimeoutMinutes | ❌ NOT_MAPPED | No | "Timeout Minutes" | BROKEN | No AI mapping |
| Reset Stop Loss After Fail | resetStopLossAfterFail | boolean | configuration.resetStopLossAfterFail | ❌ NOT_MAPPED | No | "Reset Stop Loss" | BROKEN | No AI mapping |
| **RISK MANAGEMENT** | | | | | | | | |
| Daily Profit Target | dailyProfitTarget | number | configuration.dailyProfitTarget | ❌ NOT_MAPPED | No | "Daily Profit Target" | BROKEN | No AI mapping |
| Daily Loss Limit | dailyLossLimit | number | configuration.dailyLossLimit | ❌ NOT_MAPPED | No | "Daily Loss Limit" | BROKEN | No AI mapping |
| Max Trades Per Day | maxTradesPerDay | number | configuration.maxTradesPerDay | ❌ NOT_MAPPED | No | "Max Trades/Day" | BROKEN | No AI mapping |
| Backtesting Mode | backtestingMode | boolean | configuration.backtestingMode | ❌ NOT_MAPPED | No | "Backtesting Mode" | BROKEN | No AI mapping |
| **NOTIFICATIONS** | | | | | | | | |
| Notify On Trade | notifyOnTrade | boolean | configuration.notifyOnTrade | ❌ NOT_MAPPED | No | "Trade Notifications" | BROKEN | No AI mapping |
| Notify On Error | notifyOnError | boolean | configuration.notifyOnError | ❌ NOT_MAPPED | No | "Error Notifications" | BROKEN | No AI mapping |
| Notify On Targets | notifyOnTargets | boolean | configuration.notifyOnTargets | ❌ NOT_MAPPED | No | "Target Notifications" | BROKEN | No AI mapping |
| **SHORTING** | | | | | | | | |
| Enable Shorting | enableShorting | boolean | configuration.enableShorting | ❌ NOT_MAPPED | No | "Enable Shorting" | BROKEN | No AI mapping |
| Max Short Positions | maxShortPositions | number | configuration.maxShortPositions | ❌ NOT_MAPPED | No | "Max Short Positions" | BROKEN | No AI mapping |
| Shorting Min Profit % | shortingMinProfitPercentage | number | configuration.shortingMinProfitPercentage | ❌ NOT_MAPPED | No | "Min Profit %" | BROKEN | No AI mapping |
| Auto Close Shorts | autoCloseShorts | boolean | configuration.autoCloseShorts | ❌ NOT_MAPPED | No | "Auto Close Shorts" | BROKEN | No AI mapping |
| **DOLLAR COST AVERAGING** | | | | | | | | |
| Enable DCA | enableDCA | boolean | configuration.enableDCA | ❌ NOT_MAPPED | No | "Enable DCA" | BROKEN | No AI mapping |
| DCA Interval Hours | dcaIntervalHours | number | configuration.dcaIntervalHours | ❌ NOT_MAPPED | No | "DCA Interval" | BROKEN | No AI mapping |
| DCA Steps | dcaSteps | number | configuration.dcaSteps | ❌ NOT_MAPPED | No | "DCA Steps" | BROKEN | No AI mapping |
| **AI INTELLIGENCE** | | | | | | | | |
| Enable AI Override | enableAIOverride | boolean | configuration.aiIntelligenceConfig.enableAIOverride | ✅ enableAIOverride | Yes | "Enable AI Override" | OK | Working |
| AI Autonomy Level | aiAutonomyLevel | number | configuration.aiIntelligenceConfig.aiAutonomyLevel | ✅ aiAutonomyLevel | Yes | "AI Autonomy Level" | OK | Working |
| AI Confidence Threshold | aiConfidenceThreshold | number | configuration.aiIntelligenceConfig.aiConfidenceThreshold | ✅ aiConfidenceThreshold | Yes | "Confidence Threshold" | OK | Working |
| Escalation Threshold | escalationThreshold | number | configuration.aiIntelligenceConfig.escalationThreshold | ✅ escalationThreshold | Yes | "Escalation Threshold" | OK | Working |
| Risk Override Allowed | riskOverrideAllowed | boolean | configuration.aiIntelligenceConfig.riskOverrideAllowed | ✅ riskOverrideAllowed | Yes | "Risk Override" | OK | Working |
| Enable Pattern Recognition | enablePatternRecognition | boolean | configuration.aiIntelligenceConfig.enablePatternRecognition | ❌ NOT_MAPPED | No | "Pattern Recognition" | BROKEN | No AI mapping |
| Pattern Lookback Hours | patternLookbackHours | number | configuration.aiIntelligenceConfig.patternLookbackHours | ❌ NOT_MAPPED | No | "Lookback Hours" | BROKEN | No AI mapping |
| Cross Asset Correlation | crossAssetCorrelation | boolean | configuration.aiIntelligenceConfig.crossAssetCorrelation | ❌ NOT_MAPPED | No | "Asset Correlation" | BROKEN | No AI mapping |
| Market Structure Analysis | marketStructureAnalysis | boolean | configuration.aiIntelligenceConfig.marketStructureAnalysis | ❌ NOT_MAPPED | No | "Market Analysis" | BROKEN | No AI mapping |
| Enable External Signals | enableExternalSignals | boolean | configuration.aiIntelligenceConfig.enableExternalSignals | ❌ NOT_MAPPED | No | "External Signals" | BROKEN | No AI mapping |
| Whale Activity Weight | whaleActivityWeight | number | configuration.aiIntelligenceConfig.whaleActivityWeight | ❌ NOT_MAPPED | No | "Whale Weight" | BROKEN | No AI mapping |
| Sentiment Weight | sentimentWeight | number | configuration.aiIntelligenceConfig.sentimentWeight | ❌ NOT_MAPPED | No | "Sentiment Weight" | BROKEN | No AI mapping |
| News Impact Weight | newsImpactWeight | number | configuration.aiIntelligenceConfig.newsImpactWeight | ❌ NOT_MAPPED | No | "News Weight" | BROKEN | No AI mapping |
| Social Signals Weight | socialSignalsWeight | number | configuration.aiIntelligenceConfig.socialSignalsWeight | ❌ NOT_MAPPED | No | "Social Weight" | BROKEN | No AI mapping |
| Decision Mode | decisionMode | enum | configuration.aiIntelligenceConfig.decisionMode | ❌ NOT_MAPPED | No | "Decision Mode" | BROKEN | No AI mapping |
| Enable Learning | enableLearning | boolean | configuration.aiIntelligenceConfig.enableLearning | ❌ NOT_MAPPED | No | "Enable Learning" | BROKEN | No AI mapping |
| Adapt To Performance | adaptToPerformance | boolean | configuration.aiIntelligenceConfig.adaptToPerformance | ❌ NOT_MAPPED | No | "Adapt Performance" | BROKEN | No AI mapping |
| Learning Rate | learningRate | number | configuration.aiIntelligenceConfig.learningRate | ❌ NOT_MAPPED | No | "Learning Rate" | BROKEN | No AI mapping |
| Explain Decisions | explainDecisions | boolean | configuration.aiIntelligenceConfig.explainDecisions | ❌ NOT_MAPPED | No | "Explain Decisions" | BROKEN | No AI mapping |
| Alert On Anomalies | alertOnAnomalies | boolean | configuration.aiIntelligenceConfig.alertOnAnomalies | ❌ NOT_MAPPED | No | "Alert Anomalies" | BROKEN | No AI mapping |
| Alert On Overrides | alertOnOverrides | boolean | configuration.aiIntelligenceConfig.alertOnOverrides | ❌ NOT_MAPPED | No | "Alert Overrides" | BROKEN | No AI mapping |
| Custom Instructions | customInstructions | string | configuration.aiIntelligenceConfig.customInstructions | ❌ NOT_MAPPED | No | "Custom Instructions" | BROKEN | No AI mapping |

## CRITICAL ISSUES IDENTIFIED:

### 🚨 **MISSING AI MAPPINGS: 43 out of 57 fields (75%)**
Only 14 fields are mapped to the AI assistant. The AI is blind to most of the configuration.

### 🚨 **DATA TYPE MISMATCHES:**
- `selectedCoins`: UI expects ARRAY, DB contains STRING → **UI CRASH**
- `maxWalletExposure`: AI writes to wrong nested path

### 🚨 **BROKEN SECTIONS:**
- **Buy Settings**: 80% unmapped (4/5 fields)
- **Sell Settings**: 70% unmapped (7/10 fields) 
- **Risk Management**: 100% unmapped (4/4 fields)
- **Notifications**: 100% unmapped (3/3 fields)
- **Shorting**: 100% unmapped (4/4 fields)
- **DCA**: 100% unmapped (3/3 fields)
- **AI Intelligence**: 77% unmapped (20/26 fields)

### 🚨 **CONSEQUENCE:**
User commands like "Set daily profit target to 5%, use trailing stop of 2.5%, add DOGE, notify me on errors only" **CANNOT WORK** because:
- `dailyProfitTarget` - NOT MAPPED
- `trailingStopLossPercentage` - NOT MAPPED  
- `selectedCoins` - TYPE MISMATCH
- `notifyOnError` - NOT MAPPED

**RESULT: Only 25% of the strategy configuration is accessible via AI assistant.**