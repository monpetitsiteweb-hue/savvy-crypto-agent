# Calibration System Smoke Tests

## Prerequisites

Before testing, ensure vault permissions are granted for edge functions:
```sql
create extension if not exists supabase_vault;
grant usage on schema vault to service_role;
grant select on table vault.decrypted_secrets to service_role;
```

Also ensure CRON_SECRET exists in `vault.decrypted_secrets` table.

## Test 1: Manual Invoke (should succeed without cron secret)
```javascript
// Run in browser console on Dev/Learning page
await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/calibration-aggregator', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('sb-fuieplftlcxdfkxyqzlt-auth-token') ? JSON.parse(localStorage.getItem('sb-fuieplftlcxdfkxyqzlt-auth-token')).access_token : 'YOUR_ANON_KEY'}`
  },
  body: JSON.stringify({ manual: true })
}).then(r => r.json()).then(console.log);
```

## Test 2: Scheduled call with wrong secret (should return 403)
```javascript
// Run in browser console  
await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/calibration-aggregator', {
  method: 'POST', 
  headers: {
    'Content-Type': 'application/json',
    'x-cron-secret': 'wrong-secret'
  },
  body: JSON.stringify({ scheduled: true })
}).then(r => r.status).then(console.log); // Should return 403
```

## Test 3: Scheduled call with right secret (should 200)
```javascript
// Admin only - get CRON_SECRET from vault first
// This would normally be called by the cron job, not manually
await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/calibration-aggregator', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json', 
    'Authorization': 'Bearer SERVICE_ROLE_KEY',
    'x-cron-secret': 'ACTUAL_CRON_SECRET_FROM_VAULT'
  },
  body: JSON.stringify({ scheduled: true })
}).then(r => r.json()).then(console.log);
```

## Test 4: Verify UI shows updated metrics
1. Run manual calibration via UI button
2. Check table shows "Last Computed" timestamps
3. Test horizon/symbol/strategy filters
4. Verify metrics display correctly with proper color coding