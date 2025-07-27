-- Fix QuickNode webhook URL to point to the correct endpoint
UPDATE ai_data_sources 
SET webhook_url = 'https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/whale-alert-webhook',
    configuration = jsonb_set(
      configuration, 
      '{webhook_url}', 
      '"https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/whale-alert-webhook"'
    )
WHERE source_name = 'quicknode_webhooks' AND is_active = true;