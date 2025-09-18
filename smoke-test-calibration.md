# Calibration System Smoke Tests (Ready to run)

**Requires:** vault grants for service_role and CRON_SECRET present in vault.decrypted_secrets.

If your project's PostgREST isn't exposing the vault schema, set the edge function secret CRON_SECRET to the same value stored in vault and redeploy. The function will fall back to the env value.

These tests verify the calibration-aggregator security path, manual path, and UI.

## Prerequisites (run in Supabase SQL editor)

```sql
create extension if not exists supabase_vault;
grant usage on schema vault to service_role;
grant select on table vault.decrypted_secrets to service_role;

select name, decrypted_secret
from vault.decrypted_secrets
where name = 'CRON_SECRET';
```

Expected output includes:

```
name         | decrypted_secret
-------------+--------------------------------------------------------------
CRON_SECRET  | bdcfefcd44654a9fb943a7b454eb4420019c527d824564a97be1bf2bbe3bbd15
```

## Shared setup (run once in your browser console while logged into the app)
```javascript
// Project ref and user access token (from your session)
const SB = 'fuieplftlcxdfkxyqzlt';
const tok = localStorage.getItem(`sb-${SB}-auth-token`);
if (!tok) throw new Error('No Supabase session found. Log into the app first.');
const ACCESS_TOKEN = JSON.parse(tok).access_token;

// Known-good cron secret (from vault)
const CRON_SECRET = 'bdcfefcd44654a9fb943a7b454eb4420019c527d824564a97be1bf2bbe3bbd15';

// Helper to call the function
const fn = (path, init) => fetch(`https://${SB}.supabase.co/functions/v1/${path}`, init);
console.log('Setup OK');
```

## Test 1: Manual invoke (should 200 without cron secret)
```javascript
await fn('calibration-aggregator', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ACCESS_TOKEN}`
  },
  body: JSON.stringify({ manual: true })
}).then(r => r.json()).then(console.log);
```

Expect: `success: true`, HTTP 200, summary JSON. If there are no outcomes in the last 30 days, you'll see `metrics_upserted: 0`.

## Test 2: Scheduled call with WRONG secret (should 403)
```javascript
await fn('calibration-aggregator', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'x-cron-secret': 'wrong-secret'
  },
  body: JSON.stringify({ scheduled: true })
}).then(r => r.status).then(console.log);
```

Expect: 403

## Test 3: Scheduled call with CORRECT secret (should 200)
```javascript
await fn('calibration-aggregator', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'x-cron-secret': CRON_SECRET
  },
  body: JSON.stringify({ scheduled: true })
}).then(r => r.json()).then(console.log);
```

Expect: `success: true`, HTTP 200, summary JSON.

## Test 4: Generate outcomes → aggregate → see metrics

1. Go to `/dev/learning` (temporarily admin-unlocked).
2. Click **Trigger Evaluator** (writes decision_outcomes).
3. Wait ~2–3 seconds.
4. Click **Run Calibration**.
5. Go to the **Calibration** tab and verify:
   - Rows appear (non-zero sample_count).
   - "Last Computed" shows a fresh timestamp.
   - Filters (horizon/symbol/strategy) work.

If you still see zero rows, confirm outcomes exist in the last 30 days:
```sql
select count(*) as recent_outcomes
from public.decision_outcomes o
join public.decision_events e on e.id = o.decision_id
where e.decision_ts >= now() - interval '30 days';
```

## Test 5: Scheduler wiring (Supabase Dashboard)

Edge Functions → calibration-aggregator → Schedules → Add schedule

- **Cron**: `0 2 * * *` (daily 02:00 UTC)
- **Method**: POST
- **Body**: `{"scheduled": true}`
- **Headers**:
  - `x-cron-secret`: `bdcfefcd44654a9fb943a7b454eb4420019c527d824564a97be1bf2bbe3bbd15`
  - **Authorization**: toggle **Use service role** = ON

## Test 6: Secret rotation (security hardening)

**Rotate the cron secret (SQL in Supabase SQL editor):**
```sql
select vault.update_secret('CRON_SECRET', '7d7c6f9f5d7748cdbf6a2a1a5c9a0de7f7f2c089e1f644bcb1c6c92c06f9b9e2');

-- Verify new value is active
select name, decrypted_secret
from vault.decrypted_secrets
where name = 'CRON_SECRET';
```

**Wrong (OLD) secret must fail with 403 (run in browser console):**
```javascript
const SB = 'fuieplftlcxdfkxyqzlt';
const tok = localStorage.getItem(`sb-${SB}-auth-token`);
const ACCESS_TOKEN = JSON.parse(tok).access_token;

await fetch(`https://${SB}.supabase.co/functions/v1/calibration-aggregator`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'x-cron-secret': 'bdcfefcd44654a9fb943a7b454eb4420019c527d824564a97be1bf2bbe3bbd15' // OLD secret (must 403)
  },
  body: JSON.stringify({ scheduled: true })
}).then(r => r.status).then(console.log);
```

**Correct (NEW) secret must succeed with 200 (run in browser console):**
```javascript
const SB = 'fuieplftlcxdfkxyqzlt';
const tok = localStorage.getItem(`sb-${SB}-auth-token`);
const ACCESS_TOKEN = JSON.parse(tok).access_token;

await fetch(`https://${SB}.supabase.co/functions/v1/calibration-aggregator`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'x-cron-secret': '7d7c6f9f5d7748cdbf6a2a1a5c9a0de7f7f2c089e1f644bcb1c6c92c06f9b9e2' // NEW secret (must 200)
  },
  body: JSON.stringify({ scheduled: true })
}).then(r => r.json()).then(console.log);
```

## Acceptance criteria

- Test 1 returns 200.
- Test 2 returns 403.
- Test 3 returns 200.
- Test 4 shows metrics and updated timestamps in the UI.
- Test 6 validates rotation: old secret → 403, new secret → 200.