-- Migration: Seed ai_data_sources with EODHD provider and add EODHD signal types

DO $$
DECLARE
  v_admin_user_id UUID;
BEGIN
  -- Get first admin user or fallback to first user
  SELECT user_id INTO v_admin_user_id 
  FROM public.user_roles 
  WHERE role = 'admin' 
  LIMIT 1;
  
  IF v_admin_user_id IS NULL THEN
    SELECT id INTO v_admin_user_id 
    FROM auth.users 
    LIMIT 1;
  END IF;
  
  -- Insert EODHD source if not exists
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_data_sources 
    WHERE source_name = 'eodhd' AND user_id = v_admin_user_id
  ) THEN
    INSERT INTO public.ai_data_sources (
      source_name,
      source_type,
      user_id,
      is_active,
      update_frequency,
      configuration,
      created_at,
      updated_at
    )
    VALUES (
      'eodhd',
      'api',
      v_admin_user_id,
      true,
      '5min',
      jsonb_build_object(
        'api_key', 'TO_UPDATE_BY_USER',
        'base_url', 'https://eodhd.com/api/',
        'symbols', ARRAY['BTC-EUR', 'ETH-EUR'],
        'interval', '5m'
      ),
      NOW(),
      NOW()
    );
    RAISE NOTICE 'Created eodhd source for user_id: %', v_admin_user_id;
  END IF;
END $$;

-- Add EODHD signal types to signal_registry if not exists
INSERT INTO public.signal_registry (
  key,
  category,
  description,
  default_weight,
  min_weight,
  max_weight,
  direction_hint,
  timeframe_hint,
  is_enabled,
  created_at,
  updated_at
)
VALUES
  (
    'eodhd_intraday_volume_spike',
    'eodhd',
    'Intraday volume significantly higher than average',
    1.0,
    0.0,
    3.0,
    'contextual',
    '15m',
    true,
    NOW(),
    NOW()
  ),
  (
    'eodhd_unusual_volatility',
    'eodhd',
    'Price volatility exceeds normal range',
    1.0,
    0.0,
    3.0,
    'symmetric',
    '15m',
    true,
    NOW(),
    NOW()
  ),
  (
    'eodhd_price_breakout_bullish',
    'eodhd',
    'Price breaks above resistance with strong momentum',
    1.2,
    0.0,
    3.0,
    'bullish',
    '15m',
    true,
    NOW(),
    NOW()
  ),
  (
    'eodhd_price_breakdown_bearish',
    'eodhd',
    'Price breaks below support with strong momentum',
    1.2,
    0.0,
    3.0,
    'bearish',
    '15m',
    true,
    NOW(),
    NOW()
  )
ON CONFLICT (key) DO NOTHING;