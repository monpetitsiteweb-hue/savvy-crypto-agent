-- Step 1: Make user_id nullable to support system-level sources
ALTER TABLE public.ai_data_sources 
ALTER COLUMN user_id DROP NOT NULL;

-- Step 2: Update system-level signal sources to have user_id = NULL
-- This allows all authenticated users to see these sources via RLS
UPDATE public.ai_data_sources
SET user_id = NULL
WHERE source_name IN (
  'eodhd',
  'eodhd_api',
  'whale_alert',
  'whale_alert_api',
  'cryptonews_api',
  'fear_greed_index',
  'coinbase_institutional',
  'quicknode_webhooks',
  'bigquery',
  'youtube_channels',
  'custom_website',
  'document_upload',
  'website_page'
)
AND user_id IS NOT NULL;