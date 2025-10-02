# Deployment Guide: DEV & PROD Environments

## Overview

This project maintains two Supabase environments:

- **DEV**: For development and testing (project ref: `fuieplftlcxdfkxyqzlt`)
- **PROD**: For production use (to be created)

Both environments use the same webhook-based signer service but with separate secrets and stricter limits in PROD.

## Environment Matrix

| Secret Name | DEV | PROD | Description |
|-------------|-----|------|-------------|
| `SERVER_SIGNER_MODE` | `webhook` | `webhook` | Signer mode (always webhook) |
| `DEV_SIGNER_WEBHOOK_URL` | ✅ | ❌ | DEV signer URL + `/sign` |
| `DEV_SIGNER_WEBHOOK_AUTH` | ✅ | ❌ | DEV auth (Bearer token) |
| `SIGNER_WEBHOOK_URL` | ❌ | ✅ | PROD signer URL + `/sign` |
| `SIGNER_WEBHOOK_AUTH` | ❌ | ✅ | PROD auth (Bearer token) |
| `SB_URL` | ✅ | ✅ | Supabase project URL |
| `SB_SERVICE_ROLE` | ✅ | ✅ | Service role key |
| `RPC_URL_8453` | ✅ | ✅ | Base RPC endpoint |
| `ZEROEX_API_KEY` | ✅ | ✅ | 0x API key |
| `MAX_TX_VALUE_WEI` | Optional | **Required** | Max ETH per tx (stricter in PROD) |
| `NOTIFICATION_WEBHOOK_URL` | Optional | ✅ | Slack/Discord webhook |
| `NOTIFICATION_WEBHOOK_TYPE` | Optional | Optional | `slack` or `discord` (default: slack) |

## Prerequisites

### 1. Deploy Signer Service

The signer service must be deployed to a stable host (Railway/Render/Cloud Run) for both environments.

**For DEV:**
```bash
cd signer-service

# Railway
railway up
# Note the public URL: https://onchain-signer-dev-production.up.railway.app

# Or Render
render deploy --blueprint render.yaml
```

**For PROD:**
```bash
# Deploy to separate Railway/Render service
# Use different environment name: onchain-signer-prod
```

### 2. Set Supabase Secrets

After deploying the signer, configure Supabase secrets in each environment.

**DEV Project (`fuieplftlcxdfkxyqzlt`):**

```bash
# Link to DEV project
supabase link --project-ref fuieplftlcxdfkxyqzlt

# Set secrets
supabase secrets set SERVER_SIGNER_MODE=webhook
supabase secrets set DEV_SIGNER_WEBHOOK_URL=https://your-dev-signer.railway.app/sign
supabase secrets set DEV_SIGNER_WEBHOOK_AUTH="Bearer your-dev-secret"
supabase secrets set RPC_URL_8453=https://mainnet.base.org
supabase secrets set ZEROEX_API_KEY=your-dev-0x-key
supabase secrets set SB_URL=https://fuieplftlcxdfkxyqzlt.supabase.co
supabase secrets set SB_SERVICE_ROLE=your-service-role-key
supabase secrets set MAX_TX_VALUE_WEI=1000000000000000000  # 1 ETH
supabase secrets set NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK
supabase secrets set NOTIFICATION_WEBHOOK_TYPE=slack
```

**PROD Project (TBD):**

```bash
# Link to PROD project
supabase link --project-ref YOUR_PROD_REF

# Set secrets (use PROD-specific values, no DEV_ prefix)
supabase secrets set SERVER_SIGNER_MODE=webhook
supabase secrets set SIGNER_WEBHOOK_URL=https://your-prod-signer.railway.app/sign
supabase secrets set SIGNER_WEBHOOK_AUTH="Bearer your-prod-secret"
supabase secrets set RPC_URL_8453=https://mainnet.base.org
supabase secrets set ZEROEX_API_KEY=your-prod-0x-key
supabase secrets set SB_URL=https://YOUR_PROD_REF.supabase.co
supabase secrets set SB_SERVICE_ROLE=your-prod-service-role-key
supabase secrets set MAX_TX_VALUE_WEI=100000000000000000  # 0.1 ETH (stricter)
supabase secrets set NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/PROD/WEBHOOK
```

## CI/CD Setup

### GitHub Secrets

Add these secrets to your GitHub repository (Settings → Secrets → Actions):

| Secret | Description | Example |
|--------|-------------|---------|
| `SUPABASE_ACCESS_TOKEN` | Personal access token from Supabase | `sbp_...` |
| `SB_PROJECT_REF_DEV` | DEV project ref | `fuieplftlcxdfkxyqzlt` |
| `SB_PROJECT_REF_PROD` | PROD project ref | `your-prod-ref` |

### Workflows

- **`.github/workflows/deploy-dev.yml`**: Deploys to DEV on push to `dev` branch
- **`.github/workflows/deploy-prod.yml`**: Deploys to PROD on push to `main` branch

### Manual Deployment

**DEV:**
```bash
git checkout dev
git push origin dev
# Watch: https://github.com/YOUR_REPO/actions
```

**PROD:**
```bash
git checkout main
git merge dev
git push origin main
# Watch: https://github.com/YOUR_REPO/actions
```

## Diagnostics

### Check Signer Configuration

```bash
# DEV
curl https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/onchain-signer-debug

# Expected response:
{
  "mode": "webhook",
  "config": {
    "hasWebhookUrl": true,
    "hasWebhookAuth": true,
    "urlSource": "DEV_SIGNER_WEBHOOK_URL",
    "authSource": "DEV_SIGNER_WEBHOOK_AUTH"
  },
  "chains": {
    "allowedChainIds": [8453],
    "hasRpc8453": true
  },
  "limits": {
    "valueCapConfigured": true,
    "valueCapWei": "1000000000000000000"
  },
  "warnings": []
}
```

### Check Signer Service Health

```bash
# DEV signer
curl https://your-dev-signer.railway.app/healthz
# Expected: {"status":"ok","version":"1.0.0","chain":"base"}

curl https://your-dev-signer.railway.app/version
# Expected: {"version":"1.0.0","botAddress":"0x...","chainId":8453,"maxValueWei":"..."}
```

## Smoke Tests

### End-to-End Test (DEV)

```bash
cd tests
npm install
node smoke-test.js --env dev
```

This script:
1. Builds a trade with `taker` (calls `/onchain-execute`)
2. Verifies `raw_quote.transaction.to === tx_payload.to`
3. Calls `/onchain-sign-and-send`
4. Expects `status: 'submitted'` or `BROADCAST_FAILED` (if insufficient funds)
5. Polls `/onchain-receipts` for final status

### PowerShell Test (DEV)

```powershell
cd tests
.\smoke-test.ps1 -Env dev
```

### SQL Monitoring Queries

**Recent trades:**
```sql
SELECT id, status, provider, symbol, side, chain_id, tx_hash, created_at
FROM trades
ORDER BY created_at DESC
LIMIT 20;
```

**Recent failures:**
```sql
SELECT t.id, t.status, t.provider, t.symbol, te.phase, te.severity, te.details
FROM trades t
JOIN trade_events te ON te.trade_id = t.id
WHERE t.status = 'failed' OR te.severity = 'error'
ORDER BY t.created_at DESC
LIMIT 10;
```

**Success rate (last 24h):**
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'mined') AS mined,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  COUNT(*) FILTER (WHERE status = 'submitted') AS pending,
  ROUND(COUNT(*) FILTER (WHERE status = 'mined')::numeric / COUNT(*) * 100, 2) AS success_pct
FROM trades
WHERE created_at > NOW() - INTERVAL '24 hours';
```

## Notifications

Slack/Discord webhooks fire on these events:

- `sign_attempt`: Trade enters signing flow
- `signing_failed`: Signer returned error
- `broadcast_attempt`: Signed tx ready to broadcast
- `broadcast_failed`: RPC rejected tx
- `submitted`: Tx successfully broadcast (pending)
- `mined`: Tx confirmed on-chain
- `failed`: Tx reverted or timed out

### Slack Setup

1. Create incoming webhook: https://api.slack.com/messaging/webhooks
2. Set `NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/...`
3. Set `NOTIFICATION_WEBHOOK_TYPE=slack` (or omit, slack is default)

### Discord Setup

1. Create webhook in Discord server settings
2. Set `NOTIFICATION_WEBHOOK_URL=https://discord.com/api/webhooks/...`
3. Set `NOTIFICATION_WEBHOOK_TYPE=discord`

## PROD Checklist

Before going live in PROD:

- [ ] Create new Supabase PROD project
- [ ] Deploy PROD signer service (separate instance)
- [ ] Set all PROD secrets in Supabase (use non-DEV-prefixed names)
- [ ] Set stricter `MAX_TX_VALUE_WEI` (e.g., 0.1 ETH)
- [ ] Configure PROD notification webhook
- [ ] Add `SB_PROJECT_REF_PROD` to GitHub secrets
- [ ] Test `/onchain-signer-debug` in PROD
- [ ] Run smoke test against PROD
- [ ] Monitor first few trades closely
- [ ] Set up alerts for `status='failed'` trades

## Troubleshooting

### Sign fails with "Unauthorized"

**Issue:** Signer returns 401

**Fix:** Verify `DEV_SIGNER_WEBHOOK_AUTH` in Supabase matches `WEBHOOK_AUTH` in signer service

### Sign fails with "INVALID_FROM"

**Issue:** `tx_payload.from` doesn't match `BOT_ADDRESS`

**Fix:** Ensure `taker` parameter matches the bot's address when building trades

### Broadcast fails with "nonce too low"

**Issue:** Nonce already used

**Fix:** Signer auto-fetches nonce from RPC (`pending` block tag). If issue persists, check for pending txs in mempool.

### No notifications

**Issue:** Slack/Discord not receiving messages

**Fix:** 
1. Verify `NOTIFICATION_WEBHOOK_URL` is set
2. Test webhook manually: `curl -X POST <URL> -d '{"text":"test"}'`
3. Check function logs: `supabase functions logs onchain-sign-and-send`

### Gas estimation fails

**Issue:** Signer returns "GAS_ESTIMATION_FAILED"

**Fix:**
- Ensure RPC is accessible
- Check if `to` contract exists
- Verify `data` is valid call data
- Try with explicit `gas` parameter

## Support

- **DEV Logs**: `supabase functions logs --project-ref fuieplftlcxdfkxyqzlt`
- **Signer Logs**: Railway/Render dashboard
- **Trade Events**: `SELECT * FROM trade_events WHERE phase='guard' ORDER BY created_at DESC LIMIT 20`
- **Documentation**: See `README-execute.md` for API details
