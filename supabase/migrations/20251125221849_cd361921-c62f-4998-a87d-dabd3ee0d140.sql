-- Migration: Seed ai_data_sources with whale alert providers
-- This creates the required rows for whale signal ingestion to work

DO $$
DECLARE
  v_admin_user_id UUID;
BEGIN
  -- Try to get the first admin user
  SELECT user_id INTO v_admin_user_id 
  FROM public.user_roles 
  WHERE role = 'admin' 
  LIMIT 1;
  
  -- If no admin found, get the first user
  IF v_admin_user_id IS NULL THEN
    SELECT id INTO v_admin_user_id 
    FROM auth.users 
    LIMIT 1;
  END IF;
  
  -- Insert whale_alert (webhook for tracked wallets) if not exists
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_data_sources 
    WHERE source_name = 'whale_alert' AND user_id = v_admin_user_id
  ) THEN
    INSERT INTO public.ai_data_sources (
      source_name,
      source_type,
      user_id,
      is_active,
      threshold_amount,
      update_frequency,
      configuration,
      blockchain_networks,
      created_at,
      updated_at
    )
    VALUES (
      'whale_alert',
      'webhook',
      v_admin_user_id,
      true,
      50000,
      'realtime',
      jsonb_build_object(
        'webhook_secret', 'YOUR_WEBHOOK_SECRET_HERE',
        'min_amount_usd', 50000,
        'blockchain_filter', ARRAY['ethereum', 'bitcoin', 'tron']
      ),
      ARRAY['ethereum', 'bitcoin', 'tron'],
      NOW(),
      NOW()
    );
    RAISE NOTICE 'Created whale_alert source for user_id: %', v_admin_user_id;
  ELSE
    RAISE NOTICE 'whale_alert source already exists for user_id: %', v_admin_user_id;
  END IF;

  -- Insert whale_alert_api (REST API for global whales) if not exists
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_data_sources 
    WHERE source_name = 'whale_alert_api' AND user_id = v_admin_user_id
  ) THEN
    INSERT INTO public.ai_data_sources (
      source_name,
      source_type,
      user_id,
      is_active,
      threshold_amount,
      update_frequency,
      api_endpoint,
      configuration,
      blockchain_networks,
      created_at,
      updated_at
    )
    VALUES (
      'whale_alert_api',
      'api',
      v_admin_user_id,
      true,
      50000,
      'hourly',
      'https://api.whale-alert.io/v1/transactions',
      jsonb_build_object(
        'api_key', 'YOUR_WHALE_ALERT_API_KEY_HERE',
        'min_amount_usd', 50000,
        'blockchain_filter', ARRAY['ethereum', 'bitcoin', 'tron'],
        'interval_minutes', 60
      ),
      ARRAY['ethereum', 'bitcoin', 'tron'],
      NOW(),
      NOW()
    );
    RAISE NOTICE 'Created whale_alert_api source for user_id: %', v_admin_user_id;
  ELSE
    RAISE NOTICE 'whale_alert_api source already exists for user_id: %', v_admin_user_id;
  END IF;

  RAISE NOTICE 'IMPORTANT: Update configuration.api_key and configuration.webhook_secret with real values!';
END $$;

-- Create index on source_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_ai_data_sources_source_name 
ON public.ai_data_sources(source_name) 
WHERE is_active = true;