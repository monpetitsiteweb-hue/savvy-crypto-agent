# Cross-System Field Mapping Analysis

## Complete UI to System Field Mapping Table

| UI Field Name | Internal/System Field | DB Field Path | Tooltip Label Key | AI Assistant Key | Status |
|---------------|----------------------|---------------|-------------------|------------------|---------|
| **Basic Settings** |  |  |  |  |  |
| Strategy Name | strategyName | strategy_name | "Strategy name" | ❌ MISSING | Not mapped |
| Risk Profile | riskProfile | configuration.riskProfile | "Risk Profile" | ❌ MISSING | Not mapped |
| Max Wallet Exposure | maxWalletExposure | configuration.maxWalletExposure | "Max Wallet Exposure" | ✅ maxWalletExposure | Mapped |
| Enable Live Trading | enableLiveTrading | configuration.enableLiveTrading | "Enable Live Trading" | ❌ MISSING | Not mapped |
| Enable Test Trading | enableTestTrading | configuration.enableTestTrading | "Enable Test Trading" | ❌ MISSING | Not mapped |
| **AI Intelligence** |  |  |  |  |  |
| Enable AI Intelligence | enableAIOverride | configuration.aiIntelligenceConfig.enableAIOverride | "Enable AI Decision Override" | ✅ enableAIOverride | Mapped |
| AI Autonomy Level | aiAutonomyLevel | configuration.aiIntelligenceConfig.aiAutonomyLevel | "AI Autonomy Level" | ✅ aiAutonomyLevel | Mapped |
| Confidence Threshold | aiConfidenceThreshold | configuration.aiIntelligenceConfig.aiConfidenceThreshold | "Confidence Threshold" | ✅ aiConfidenceThreshold | Mapped |
| Escalation Threshold | escalationThreshold | configuration.aiIntelligenceConfig.escalationThreshold | "Escalation Threshold" | ✅ escalationThreshold | Mapped |
| Allow Risk Parameter Override | riskOverrideAllowed | configuration.aiIntelligenceConfig.riskOverrideAllowed | "Allow Risk Parameter Override" | ✅ riskOverrideAllowed | Mapped |
| Enable Pattern Recognition | enablePatternRecognition | configuration.aiIntelligenceConfig.enablePatternRecognition | "Enable Pattern Recognition" | ❌ MISSING | Not mapped |
| Pattern Lookback Hours | patternLookbackHours | configuration.aiIntelligenceConfig.patternLookbackHours | "Pattern Analysis Lookback" | ❌ MISSING | Not mapped |
| Cross Asset Correlation | crossAssetCorrelation | configuration.aiIntelligenceConfig.crossAssetCorrelation | "Cross-Asset Correlation Analysis" | ❌ MISSING | Not mapped |
| Market Structure Analysis | marketStructureAnalysis | configuration.aiIntelligenceConfig.marketStructureAnalysis | "Market Structure Analysis" | ❌ MISSING | Not mapped |
| Enable External Signals | enableExternalSignals | configuration.aiIntelligenceConfig.enableExternalSignals | "Enable External Signal Processing" | ❌ MISSING | Not mapped |
| Whale Activity Weight | whaleActivityWeight | configuration.aiIntelligenceConfig.whaleActivityWeight | "Whale Activity" | ❌ MISSING | Not mapped |
| Sentiment Weight | sentimentWeight | configuration.aiIntelligenceConfig.sentimentWeight | "Market Sentiment" | ❌ MISSING | Not mapped |
| News Impact Weight | newsImpactWeight | configuration.aiIntelligenceConfig.newsImpactWeight | "News Impact" | ❌ MISSING | Not mapped |
| Social Signals Weight | socialSignalsWeight | configuration.aiIntelligenceConfig.socialSignalsWeight | "Social Signals" | ❌ MISSING | Not mapped |
| Decision Mode | decisionMode | configuration.aiIntelligenceConfig.decisionMode | "Decision Making Mode" | ❌ MISSING | Not mapped |
| Enable Learning | enableLearning | configuration.aiIntelligenceConfig.enableLearning | "Enable AI Learning" | ❌ MISSING | Not mapped |
| Adapt to Performance | adaptToPerformance | configuration.aiIntelligenceConfig.adaptToPerformance | "Adapt to Performance" | ❌ MISSING | Not mapped |
| Learning Rate | learningRate | configuration.aiIntelligenceConfig.learningRate | "Learning Rate" | ❌ MISSING | Not mapped |
| Explain Decisions | explainDecisions | configuration.aiIntelligenceConfig.explainDecisions | "Explain AI Decisions" | ❌ MISSING | Not mapped |
| Alert on Anomalies | alertOnAnomalies | configuration.aiIntelligenceConfig.alertOnAnomalies | "Alert on Anomalies" | ❌ MISSING | Not mapped |
| Alert on Overrides | alertOnOverrides | configuration.aiIntelligenceConfig.alertOnOverrides | "Alert on Overrides" | ❌ MISSING | Not mapped |
| Custom Instructions | customInstructions | configuration.aiIntelligenceConfig.customInstructions | "Custom Instructions" | ❌ MISSING | Not mapped |
| **Coins and Amounts** |  |  |  |  |  |
| Selected Coins | selectedCoins | configuration.selectedCoins | "Selected Coins" | ✅ selectedCoins | Mapped |
| Max Active Coins | maxActiveCoins | configuration.maxActiveCoins | "Max Active Coins" | ❌ MISSING | Not mapped |
| Auto Coin Selection | enableAutoCoinSelection | configuration.enableAutoCoinSelection | "Auto Coin Selection" | ❌ MISSING | Not mapped |
| Amount Per Trade | perTradeAllocation | configuration.perTradeAllocation | "Amount Per Trade" | ✅ perTradeAllocation | Mapped |
| Allocation Unit | allocationUnit | configuration.allocationUnit | "Allocation Unit" | ❌ MISSING | Not mapped |
| **Buy/Sell Settings** |  |  |  |  |  |
| Buy Order Type | buyOrderType | configuration.buyOrderType | "Buy Order Type" | ✅ buyOrderType | Mapped |
| Trailing Buy Percentage | trailingBuyPercentage | configuration.trailingBuyPercentage | "Trailing Buy Percentage" | ❌ MISSING | Not mapped |
| Buy Frequency | buyFrequency | configuration.buyFrequency | "Buy Frequency" | ❌ MISSING | Not mapped |
| Buy Interval Minutes | buyIntervalMinutes | configuration.buyIntervalMinutes | "Buy Interval (minutes)" | ❌ MISSING | Not mapped |
| Buy Cooldown Minutes | buyCooldownMinutes | configuration.buyCooldownMinutes | "Buy Cooldown" | ❌ MISSING | Not mapped |
| Sell Order Type | sellOrderType | configuration.sellOrderType | "Sell Order Type" | ✅ sellOrderType | Mapped |
| Take Profit Percentage | takeProfitPercentage | configuration.takeProfitPercentage | "Take Profit Percentage" | ✅ takeProfitPercentage | Mapped |
| Stop Loss Percentage | stopLossPercentage | configuration.stopLossPercentage | "Stop Loss Percentage" | ✅ stopLossPercentage | Mapped |
| Trailing Stop Loss Percentage | trailingStopLossPercentage | configuration.trailingStopLossPercentage | "Trailing Stop Loss Percentage" | ❌ MISSING | Not mapped |
| Auto Close After Hours | autoCloseAfterHours | configuration.autoCloseAfterHours | "Auto Close After Hours" | ❌ MISSING | Not mapped |
| **Position Management** |  |  |  |  |  |
| Max Open Positions | maxOpenPositions | configuration.maxOpenPositions | "Max Open Positions" | ❌ MISSING | Not mapped |
| Daily Profit Target | dailyProfitTarget | configuration.dailyProfitTarget | "Daily Profit Target" | ❌ MISSING | Not mapped |
| Daily Loss Limit | dailyLossLimit | configuration.dailyLossLimit | "Daily Loss Limit" | ❌ MISSING | Not mapped |
| Max Trades Per Day | maxTradesPerDay | configuration.maxTradesPerDay | "Max Trades Per Day" | ❌ MISSING | Not mapped |
| Trade Cooldown Minutes | tradeCooldownMinutes | configuration.tradeCooldownMinutes | "Trade Cooldown" | ❌ MISSING | Not mapped |
| **DCA & Advanced** |  |  |  |  |  |
| Enable DCA | enableDCA | configuration.enableDCA | "Enable DCA" | ❌ MISSING | Not mapped |
| DCA Interval Hours | dcaIntervalHours | configuration.dcaIntervalHours | "DCA Interval Hours" | ❌ MISSING | Not mapped |
| DCA Steps | dcaSteps | configuration.dcaSteps | "DCA Steps" | ❌ MISSING | Not mapped |
| Enable Stop Loss Timeout | enableStopLossTimeout | configuration.enableStopLossTimeout | "Enable Stop Loss Timeout" | ❌ MISSING | Not mapped |
| Stop Loss Timeout Minutes | stopLossTimeoutMinutes | configuration.stopLossTimeoutMinutes | "Stop Loss Timeout Minutes" | ❌ MISSING | Not mapped |
| Use Trailing Stop Only | useTrailingStopOnly | configuration.useTrailingStopOnly | "Use Trailing Stop Only" | ❌ MISSING | Not mapped |
| Reset Stop Loss After Fail | resetStopLossAfterFail | configuration.resetStopLossAfterFail | "Reset Stop Loss After Fail" | ❌ MISSING | Not mapped |
| **Shorting** |  |  |  |  |  |
| Enable Shorting | enableShorting | configuration.enableShorting | "Enable Shorting" | ❌ MISSING | Not mapped |
| Max Short Positions | maxShortPositions | configuration.maxShortPositions | "Max Short Positions" | ❌ MISSING | Not mapped |
| Shorting Min Profit Percentage | shortingMinProfitPercentage | configuration.shortingMinProfitPercentage | "Shorting Min Profit Percentage" | ❌ MISSING | Not mapped |
| Auto Close Shorts | autoCloseShorts | configuration.autoCloseShorts | "Auto Close Shorts" | ❌ MISSING | Not mapped |
| **Notifications** |  |  |  |  |  |
| Notify on Trade | notifyOnTrade | configuration.notifyOnTrade | "Notify on Trade" | ❌ MISSING | Not mapped |
| Notify on Error | notifyOnError | configuration.notifyOnError | "Notify on Error" | ❌ MISSING | Not mapped |
| Notify on Targets | notifyOnTargets | configuration.notifyOnTargets | "Notify on Targets" | ❌ MISSING | Not mapped |
| **Advanced Settings** |  |  |  |  |  |
| Backtesting Mode | backtestingMode | configuration.backtestingMode | "Backtesting Mode" | ❌ MISSING | Not mapped |
| Category | category | configuration.category | "Category" | ❌ MISSING | Not mapped |
| Tags | tags | configuration.tags | "Tags" | ❌ MISSING | Not mapped |
| Notes | notes | description | "Notes" | ❌ MISSING | Not mapped |

## Summary

**✅ Currently Mapped Fields (5/60+):**
- enableAIOverride
- aiAutonomyLevel  
- aiConfidenceThreshold
- escalationThreshold
- riskOverrideAllowed

**❌ Missing Fields (55+ fields):**
- All Basic Settings fields
- 18/23 AI Intelligence fields
- 4/5 Coins and Amounts fields
- 7/9 Buy/Sell Settings fields
- All Position Management fields (5 fields)
- All DCA & Advanced fields (7 fields)
- All Shorting fields (4 fields)
- All Notification fields (3 fields)
- All Advanced Settings fields (4 fields)

## Issues Identified

1. **Field Name Consistency**: ✅ UI field names match system/database field names consistently
2. **Tooltip System**: ✅ Uses correct UI field names, not hardcoded text
3. **AI Assistant Coverage**: ❌ Only covers 8% of available fields (5 out of 60+)
4. **Database Path Mapping**: ✅ Database paths are correctly structured and nested

## Recommended Actions

1. **Add all missing field mappings** to the AI assistant's `FIELD_DEFINITIONS`
2. **Create field validation** for array and enum types
3. **Add bulk operation handlers** for "all coins" and notification management
4. **Implement automated consistency checks** to prevent future drift