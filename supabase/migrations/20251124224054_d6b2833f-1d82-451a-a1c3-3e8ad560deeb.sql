-- Whale Signals Phase 1: Add whale signal types to signal_registry
-- These signals will be used for both tracked wallets (webhook) and global whales (API)

INSERT INTO public.signal_registry (key, category, direction_hint, timeframe_hint, default_weight, min_weight, max_weight, description, is_enabled) VALUES
  -- Exchange flow signals (most common)
  ('whale_exchange_inflow', 'whale', 'bearish', '1h', 1.2, 0.0, 3.0, 'Large transfer INTO an exchange (bearish: potential sell pressure)', true),
  ('whale_exchange_outflow', 'whale', 'bullish', '1h', 1.2, 0.0, 3.0, 'Large transfer OUT OF an exchange (bullish: HODLing/accumulation)', true),
  
  -- Generic transfer signals
  ('whale_transfer', 'whale', 'symmetric', '15m', 0.8, 0.0, 2.0, 'Large whale-to-whale transfer (neutral directional bias)', true),
  
  -- Stablecoin signals (liquidity indicators)
  ('whale_usdt_injection', 'whale', 'bullish', '4h', 1.1, 0.0, 2.5, 'Large USDT moved to exchange (potential buying power)', true),
  ('whale_usdc_injection', 'whale', 'bullish', '4h', 1.1, 0.0, 2.5, 'Large USDC moved to exchange (potential buying power)', true),
  ('whale_stablecoin_mint', 'whale', 'bullish', '4h', 1.3, 0.0, 3.0, 'New stablecoin minting (increased market liquidity)', true),
  ('whale_stablecoin_burn', 'whale', 'bearish', '4h', 1.0, 0.0, 2.5, 'Stablecoin burning (reduced market liquidity)', true),
  
  -- Anomaly signals
  ('whale_unusual_activity_spike', 'whale', 'symmetric', '15m', 1.5, 0.0, 3.0, 'Unusual spike in whale activity volume (high attention)', true),
  ('whale_chain_anomaly', 'whale', 'symmetric', '1h', 1.0, 0.0, 2.0, 'Unusual on-chain pattern detected', true)
ON CONFLICT (key) DO NOTHING;