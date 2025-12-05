
-- Update strategy configuration with recommended optimal settings
UPDATE trading_strategies
SET configuration = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    jsonb_set(
                      jsonb_set(
                        jsonb_set(
                          jsonb_set(
                            jsonb_set(
                              jsonb_set(
                                jsonb_set(
                                  configuration,
                                  '{enterThreshold}', '0.15'
                                ),
                                '{exitThreshold}', '0.10'
                              ),
                              '{spreadThresholdBps}', '30'
                            ),
                            '{minDepthRatio}', '0.2'
                          ),
                          '{takeProfitPercentage}', '0.7'
                        ),
                        '{stopLossPercentage}', '0.7'
                      ),
                      '{trailingStopPercentage}', '1.5'
                    ),
                    '{trailingStopMinProfit}', '0.5'
                  ),
                  '{minHoldPeriodMs}', '120000'
                ),
                '{min_confidence}', '0.20'
              ),
              '{aiIntelligenceConfig,autonomyLevel}', '70'
            ),
            '{aiIntelligenceConfig,decisionMode}', '"balanced"'
          ),
          '{aiIntelligenceConfig,learningRate}', '80'
        ),
        '{maxActiveCoins}', '6'
      ),
      '{maxWalletExposurePct}', '80'
    ),
    '{perTradeAllocation}', '400'
  ),
  '{selectedCoins}', '["BTC", "ETH", "SOL", "AVAX", "XRP", "ADA"]'
)
WHERE id = '018e9f3a-0d1d-7de1-9e94-aa7b1b1e7000';
