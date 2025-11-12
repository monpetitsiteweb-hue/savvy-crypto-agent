# Production Deployment - Ready to Execute

## ✅ Configuration Summary

All Supabase secrets have been configured:

- **SIGNER_WEBHOOK_URL**: `https://signer.crypto.mon-petit-site-web.fr`
- **SIGNER_WEBHOOK_AUTH**: `14c0a54...` (64-char HMAC)
- **MAX_SELL_WEI**: `200000000000000000` (0.2 WETH)
- **MAX_SLIPPAGE_BPS**: `75` (0.75%)

## 🚀 Deployment Steps

### 1. Server Setup (217.160.0.96)

```bash
# SSH to server
ssh root@217.160.0.96

# Install dependencies
sudo apt update && sudo apt upgrade -y
sudo apt install docker.io docker-compose nginx certbot python3-certbot-nginx -y

# Create application directory
sudo mkdir -p /opt/permit-signer
```

### 2. Deploy Permit-Signer

```bash
# Copy files from local machine
cd /path/to/your/project
scp -r signer-service/* root@217.160.0.96:/opt/permit-signer/

# On server: Create .env.prod
ssh root@217.160.0.96
cd /opt/permit-signer

cat > .env.prod <<'EOF'
NODE_ENV=production
PORT=8787
BOT_PRIVATE_KEY=<PASTE_YOUR_BOT_PRIVATE_KEY_HERE>
BOT_ADDRESS=<PASTE_YOUR_BOT_ADDRESS_HERE>
WEBHOOK_AUTH=legacy_token
HMAC_ACTIVE=14c0a54cca50acff0d2b03548e61d949d5f392d69ba6b60276929285085047babba615c223e180da4dc9f79b2bc900e87d9eb9cbcaee842dff9cd423f35503cb
HMAC_PREVIOUS=
RPC_URL_8453=https://mainnet.base.org
MAX_TX_VALUE_WEI=1000000000000000000
ALLOW_CHAIN_ID=8453
EOF

chmod 600 .env.prod

# Build and start
docker-compose build
docker-compose up -d

# Verify
docker-compose logs -f permit-signer
curl http://127.0.0.1:8787/healthz
```

### 3. Configure Nginx with SSL

```bash
# Get SSL certificate
sudo certbot certonly --nginx -d signer.crypto.mon-petit-site-web.fr

# Copy nginx config
sudo cp /opt/permit-signer/nginx.conf /etc/nginx/sites-available/permit-signer

# IMPORTANT: Update Supabase egress IPs in nginx.conf
# Edit lines 36-38 with your actual Supabase egress IPs
sudo nano /etc/nginx/sites-available/permit-signer

# Enable site
sudo ln -s /etc/nginx/sites-available/permit-signer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4. Configure Firewall

```bash
# Enable UFW
sudo ufw enable

# Allow necessary ports
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP (Let's Encrypt)
sudo ufw allow 443/tcp  # HTTPS

sudo ufw status verbose
```

### 5. Test from Supabase

Create a test Edge Function to verify connectivity:

```typescript
// Test edge function
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  try {
    const signerUrl = Deno.env.get("SIGNER_WEBHOOK_URL");
    const signerHmac = Deno.env.get("SIGNER_WEBHOOK_AUTH");
    
    // Test health endpoint
    const healthResp = await fetch(`${signerUrl}/healthz`);
    const healthData = await healthResp.json();
    
    // Test version endpoint with HMAC
    const versionResp = await fetch(`${signerUrl}/version`, {
      headers: { "x-hmac": signerHmac }
    });
    const versionData = await versionResp.json();
    
    return new Response(JSON.stringify({
      ok: true,
      health: healthData,
      version: versionData
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
```

## 📋 Pre-Flight Checklist

Before deploying to production:

- [ ] DNS A record points to 217.160.0.96
- [ ] SSL certificate obtained for signer.crypto.mon-petit-site-web.fr
- [ ] Bot private key and address ready
- [ ] Supabase egress IPs obtained and configured in nginx.conf
- [ ] Firewall rules configured
- [ ] Docker container running and healthy
- [ ] Nginx reverse proxy configured and tested
- [ ] HMAC authentication working
- [ ] Safety guards tested (MAX_SELL_WEI, MAX_SLIPPAGE_BPS)

## 🧪 Validation Tests

### Test 1: Health Check

```bash
curl https://signer.crypto.mon-petit-site-web.fr/healthz
# Expected: {"ok":true,"address":"0x...","chainId":8453}
```

### Test 2: Version Check (from Supabase)

From an Edge Function:
```typescript
const response = await fetch(
  `${Deno.env.get("SIGNER_WEBHOOK_URL")}/version`,
  { headers: { "x-hmac": Deno.env.get("SIGNER_WEBHOOK_AUTH") } }
);
```

Expected: `{"version":"1.1.0","botAddress":"0x...","chainId":8453}`

### Test 3: Safety Guards

Test in `onchain-execute`:
- Try selling 1.0 WETH → Should reject with `sell_amount_too_large`
- Try slippage of 100 BPS → Should reject with `slippage_too_high`
- Try selling 0.1 WETH with 50 BPS → Should succeed

### Test 4: End-to-End Permit2 Signing

```bash
# Call onchain-execute with simulateOnly
curl -X POST "https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/onchain-execute" \
     -H "Authorization: Bearer eyJhbGci..." \
     -H "Content-Type: application/json" \
     -d '{
       "chainId": 8453,
       "base": "WETH",
       "quote": "USDC",
       "side": "SELL",
       "amount": 0.05,
       "slippageBps": 50,
       "provider": "0x",
       "taker": "0xYourAddress",
       "simulateOnly": true
     }'
```

Expected: Response includes `permit2Data` with signature

## 🔄 HMAC Rotation (90-day schedule)

```bash
# On server
cd /opt/permit-signer
./rotate-hmac.sh 60  # 60-minute grace period

# Update Supabase with new HMAC from output
supabase secrets set SIGNER_WEBHOOK_AUTH=<new_hmac_from_output>

# Wait 60 minutes, then cleanup
sed -i 's/^HMAC_PREVIOUS=.*/HMAC_PREVIOUS=/' .env.prod
docker-compose restart
```

## 🚨 Rollback Plan

If issues arise:

```bash
# Stop container
docker-compose down

# Restore previous .env.prod
cp /opt/permit-signer/backups/.env.prod.YYYYMMDD_HHMMSS /opt/permit-signer/.env.prod

# Restart
docker-compose up -d

# Revert Supabase secrets
supabase secrets set SIGNER_WEBHOOK_AUTH=<previous_hmac>
```

## 📞 Support

- Signer logs: `docker-compose logs -f permit-signer`
- Nginx logs: `sudo tail -f /var/log/nginx/permit-signer-access.log`
- Edge function logs: Supabase dashboard → Functions → onchain-execute → Logs
- Full deployment guide: `DEPLOY.md`

---

**Status**: ✅ Secrets configured, ready for server deployment
**Last Updated**: 2025-11-12
