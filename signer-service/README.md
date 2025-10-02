# On-Chain Signer Service

Webhook service for signing Ethereum transactions (0x trades on Base).

## Features

- ✅ EIP-1559 transaction signing with viem
- ✅ Automatic gas estimation (+10% buffer)
- ✅ Dynamic fee calculation (or fallback to safe defaults)
- ✅ Value cap enforcement (MAX_TX_VALUE_WEI)
- ✅ From address validation (must match BOT_ADDRESS)
- ✅ Health & version endpoints
- ✅ Structured logging (no secrets)

## Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `BOT_PRIVATE_KEY` | ✅ | Private key (0x-prefixed) | `0xabc...` |
| `BOT_ADDRESS` | ✅ | Expected from address | `0xYourBotAddress` |
| `WEBHOOK_AUTH` | ✅ | Bearer token for auth | `your-secret-token` |
| `RPC_URL_8453` | ⚠️  | Base RPC URL | `https://mainnet.base.org` |
| `MAX_TX_VALUE_WEI` | ⚠️  | Max ETH value (wei) | `1000000000000000000` (1 ETH) |
| `PORT` | ⚠️  | Server port | `3000` |

## Deployment

### Railway (One-Click)

1. Click: [![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)
2. Set environment variables in Railway dashboard
3. Note the public URL (e.g., `https://onchain-signer-dev-production.up.railway.app`)
4. Set `DEV_SIGNER_WEBHOOK_URL` in Supabase to this URL + `/sign`
5. Set `DEV_SIGNER_WEBHOOK_AUTH` to `Bearer <WEBHOOK_AUTH>`

### Render (One-Click)

1. Fork this repo or create from blueprint
2. Connect Render to your GitHub
3. Create new Web Service from `render.yaml`
4. Set secret environment variables
5. Note the service URL
6. Update Supabase secrets

### Docker (Local Dev)

```bash
# Build
docker build -t onchain-signer .

# Run
docker run -p 3000:3000 \
  -e BOT_PRIVATE_KEY="0x..." \
  -e BOT_ADDRESS="0x..." \
  -e WEBHOOK_AUTH="your-secret" \
  -e RPC_URL_8453="https://mainnet.base.org" \
  onchain-signer
```

### Node.js (Local Dev)

```bash
npm install
export BOT_PRIVATE_KEY="0x..."
export BOT_ADDRESS="0x..."
export WEBHOOK_AUTH="your-secret"
export RPC_URL_8453="https://mainnet.base.org"
npm start
```

## API Endpoints

### `GET /healthz`

Health check.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "chain": "base"
}
```

### `GET /version`

Service metadata.

**Response:**
```json
{
  "version": "1.0.0",
  "botAddress": "0x...",
  "chainId": 8453,
  "maxValueWei": "1000000000000000000"
}
```

### `POST /sign`

Sign a transaction.

**Headers:**
- `Authorization: Bearer <WEBHOOK_AUTH>`

**Request Body:**
```json
{
  "chainId": 8453,
  "from": "0x...",
  "to": "0x...",
  "data": "0x...",
  "value": "0x0",
  "gas": "0x5208",
  "maxFeePerGas": "0x...",
  "maxPriorityFeePerGas": "0x...",
  "nonce": 42
}
```

**Response (Success):**
```json
{
  "ok": true,
  "signedTx": "0x...",
  "metadata": {
    "chainId": 8453,
    "from": "0x...",
    "to": "0x...",
    "nonce": 42,
    "gas": "21000",
    "maxFeePerGas": "1000000000",
    "maxPriorityFeePerGas": "2000000000",
    "estimatedMs": 234
  }
}
```

**Error Responses:**

- `401 Unauthorized`: Missing or invalid auth
- `400 INVALID_CHAIN`: Chain ID not supported
- `400 INVALID_FROM`: From address doesn't match BOT_ADDRESS
- `400 INVALID_TO`: Missing or zero recipient
- `400 VALUE_EXCEEDS_CAP`: Transaction value exceeds MAX_TX_VALUE_WEI
- `400 GAS_ESTIMATION_FAILED`: Could not estimate gas
- `500 SIGNING_FAILED`: Internal signing error

## Supabase Configuration

After deploying, update your Supabase project secrets:

### DEV Project

```bash
# Set webhook URL (Railway example)
supabase secrets set DEV_SIGNER_WEBHOOK_URL=https://your-service.railway.app/sign

# Set auth token
supabase secrets set DEV_SIGNER_WEBHOOK_AUTH="Bearer your-secret-token"

# Set signer mode
supabase secrets set SERVER_SIGNER_MODE=webhook
```

### PROD Project

```bash
# Use non-DEV-prefixed names in PROD
supabase secrets set SIGNER_WEBHOOK_URL=https://your-prod-service.railway.app/sign
supabase secrets set SIGNER_WEBHOOK_AUTH="Bearer your-prod-token"
supabase secrets set SERVER_SIGNER_MODE=webhook
```

## Testing

```bash
# Health check
curl https://your-service.railway.app/healthz

# Version
curl https://your-service.railway.app/version

# Sign (requires auth)
curl -X POST https://your-service.railway.app/sign \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "chainId": 8453,
    "from": "0xYourBotAddress",
    "to": "0xRecipient",
    "data": "0x",
    "value": "0x0"
  }'
```

## Security Notes

- **Never commit** `BOT_PRIVATE_KEY` to version control
- **Rotate** `WEBHOOK_AUTH` regularly
- **Use** environment variables or secret management
- **Monitor** logs for unauthorized attempts
- **Set** strict `MAX_TX_VALUE_WEI` in production
- **Whitelist** caller IPs if possible (Supabase edge function IPs)

## Logs

Service logs structured JSON for monitoring:

```
✅ Signer initialized: { version, botAddress, chainId, rpcUrl }
📝 Sign request: { chainId, from, to, hasData, gas, nonce }
✅ Gas estimated: 50000 → 55000 (with buffer)
✅ Fees: maxFee=10 gwei, maxPriority=2 gwei
✅ Transaction signed in 234ms: { to, value, gas, nonce }
❌ Invalid chain: 1
🔒 Unauthorized request: { ip, path }
```

## Support

For issues or questions, check:
- Supabase function logs: `supabase functions logs onchain-sign-and-send`
- Signer service logs: Railway/Render dashboard
- Trade events: `SELECT * FROM trade_events WHERE phase='guard' ORDER BY created_at DESC LIMIT 10`
