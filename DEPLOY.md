# Permit-Signer Production Deployment Guide

Complete deployment guide for containerized permit-signer service with HMAC rotation and Supabase integration.

---

## 🎯 Overview

This guide covers:
- Containerized permit-signer deployment
- HTTPS reverse proxy with Nginx
- Firewall configuration and IP allowlisting
- Supabase secrets configuration
- HMAC rotation mechanism
- Safety guards in edge functions
- Testing and rollback procedures

---

## 📋 Prerequisites

- **Server Requirements**:
  - Ubuntu 20.04/22.04 or similar Linux
  - Docker & Docker Compose installed
  - Nginx installed
  - **Domain**: signer.crypto.mon-petit-site-web.fr
  - **Server IP**: 217.160.0.96 (IPv4) / 2001:8d8:100f:f000:0:0:0:29b (IPv6)
  - SSL certificate (Let's Encrypt recommended)

- **Access Requirements**:
  - SSH access to server (217.160.0.96)
  - Supabase project access (CLI authenticated)
  - Private key for bot wallet (Base chain)

---

## 1️⃣ Server Setup

### Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose -y

# Install Nginx
sudo apt install nginx -y

# Install Certbot for SSL
sudo apt install certbot python3-certbot-nginx -y
```

### Create Application Directory

```bash
sudo mkdir -p /opt/permit-signer
sudo chown $USER:$USER /opt/permit-signer
cd /opt/permit-signer
```

---

## 2️⃣ Deploy Permit-Signer

### Copy Application Files

```bash
# Copy from your local signer-service directory to server
scp -r signer-service/* user@yourserver:/opt/permit-signer/
```

### Create Production Environment File

```bash
cd /opt/permit-signer

# Production HMAC (already generated)
HMAC_SECRET="14c0a54cca50acff0d2b03548e61d949d5f392d69ba6b60276929285085047babba615c223e180da4dc9f79b2bc900e87d9eb9cbcaee842dff9cd423f35503cb"

# Create .env.prod
cat > .env.prod <<EOF
NODE_ENV=production
PORT=8787
BOT_PRIVATE_KEY=<YOUR_BOT_PRIVATE_KEY_HERE>
BOT_ADDRESS=<YOUR_BOT_ADDRESS_HERE>
WEBHOOK_AUTH=legacy_auth_token
HMAC_ACTIVE=$HMAC_SECRET
HMAC_PREVIOUS=
RPC_URL_8453=https://mainnet.base.org
MAX_TX_VALUE_WEI=1000000000000000000
ALLOW_CHAIN_ID=8453
EOF

# Secure the file
chmod 600 .env.prod
```

**⚠️ NOTE**: You need to provide your bot's private key and address before starting the service.

### Build and Start Container

```bash
# Build image
docker-compose build

# Start service
docker-compose up -d

# Check logs
docker-compose logs -f permit-signer

# Verify health
curl http://127.0.0.1:8787/healthz
# Expected: {"status":"ok","version":"1.1.0","chain":"base"}
```

---

## 3️⃣ Configure Nginx Reverse Proxy

### Get Supabase Egress IPs

**⚠️ ACTION REQUIRED**: You need to obtain your Supabase project's egress IPs to configure the Nginx allowlist.

1. Go to your Supabase project dashboard
2. Navigate to Settings → API
3. Note the region (e.g., `us-east-1`, `eu-west-1`)
4. Contact Supabase support or check documentation for egress IPs

Once you have the IPs, update lines 36-38 in `signer-service/nginx.conf`.

### Setup SSL Certificate

```bash
# Production domain
DOMAIN="signer.crypto.mon-petit-site-web.fr"

# Get certificate
sudo certbot certonly --nginx -d $DOMAIN

# Certificates will be at:
# /etc/letsencrypt/live/signer.crypto.mon-petit-site-web.fr/fullchain.pem
# /etc/letsencrypt/live/signer.crypto.mon-petit-site-web.fr/privkey.pem
```

### Install Nginx Configuration

```bash
# Copy nginx config
sudo cp nginx.conf /etc/nginx/sites-available/permit-signer

# Edit to set your domain and Supabase IPs
sudo nano /etc/nginx/sites-available/permit-signer

# Update these lines:
# - server_name signer.yourdomain.com;
# - ssl_certificate paths
# - allow directives with real Supabase IPs

# Enable site
sudo ln -s /etc/nginx/sites-available/permit-signer /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Verify HTTPS Access

```bash
# Test health endpoint (public)
curl https://signer.crypto.mon-petit-site-web.fr/healthz
# Expected: {"ok":true,"address":"0x...","chainId":8453}

# Test version endpoint (requires HMAC, only from Supabase IPs)
curl -H "x-hmac: 14c0a54cca50acff0d2b03548e61d949d5f392d69ba6b60276929285085047babba615c223e180da4dc9f79b2bc900e87d9eb9cbcaee842dff9cd423f35503cb" \
     https://signer.crypto.mon-petit-site-web.fr/version
# Expected: {"version":"1.1.0","botAddress":"0x...","chainId":8453,...}
```

---

## 4️⃣ Firewall Configuration

### Setup UFW (Uncomplicated Firewall)

```bash
# Enable UFW
sudo ufw enable

# Allow SSH (important!)
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS from anywhere (for Let's Encrypt and public access)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Check status
sudo ufw status verbose

# The Docker container port (8787) is bound to 127.0.0.1 only,
# so it's not exposed to the internet - only Nginx can reach it
```

**Security Notes**:
- Port 8787 is only accessible via localhost
- Nginx enforces IP allowlist for Supabase
- All other IPs get 403 Forbidden

---

## 5️⃣ Configure Supabase Secrets

### Production Secrets

✅ **ALREADY CONFIGURED** - The following secrets have been set in your Supabase project:

```bash
# Production signer URL
SIGNER_WEBHOOK_URL=https://signer.crypto.mon-petit-site-web.fr

# Production HMAC authentication
SIGNER_WEBHOOK_AUTH=14c0a54cca50acff0d2b03548e61d949d5f392d69ba6b60276929285085047babba615c223e180da4dc9f79b2bc900e87d9eb9cbcaee842dff9cd423f35503cb

# Safety guards
MAX_SELL_WEI=200000000000000000    # 0.2 WETH
MAX_SLIPPAGE_BPS=75                # 0.75%
```

Verify with:
```bash
supabase secrets list
```

### Local Development Secrets

For local testing with `supabase functions serve`:

```bash
# Point to local signer
supabase secrets set --local SIGNER_WEBHOOK_URL=http://127.0.0.1:8787
supabase secrets set --local SIGNER_WEBHOOK_AUTH=YOUR_LOCAL_HMAC

# Local safety guards (more permissive for testing)
supabase secrets set --local MAX_SELL_WEI=1000000000000000000  # 1 ETH
supabase secrets set --local MAX_SLIPPAGE_BPS=200              # 2%
```

### Deploy Edge Functions

```bash
# Deploy updated onchain-execute with safety guards
supabase functions deploy onchain-execute

# Verify deployment
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/onchain-execute" \
     -H "Authorization: Bearer SUPABASE_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "chainId": 8453,
       "base": "WETH",
       "quote": "USDC",
       "side": "SELL",
       "amount": 0.1,
       "provider": "0x",
       "taker": "0xYourAddress",
       "mode": "build",
       "simulateOnly": true
     }'
```

---

## 6️⃣ HMAC Rotation

### Perform Rotation

```bash
cd /opt/permit-signer

# Make rotation script executable
chmod +x rotate-hmac.sh

# Run rotation (60-minute grace period)
./rotate-hmac.sh 60

# Script will:
# 1. Backup current .env.prod
# 2. Generate new HMAC_ACTIVE
# 3. Move old HMAC_ACTIVE → HMAC_PREVIOUS
# 4. Restart container
# 5. Schedule cleanup reminder
```

### Update Supabase Secrets

After rotation, update Supabase to use new HMAC:

```bash
# Use the new HMAC_ACTIVE value from rotation script output
supabase secrets set SIGNER_WEBHOOK_AUTH=NEW_HMAC_ACTIVE_HERE

# Verify both HMACs work during grace period
# Old HMAC (HMAC_PREVIOUS) should still work for 60 minutes
```

### Complete Rotation (After Grace Period)

```bash
# After 60 minutes, remove HMAC_PREVIOUS
cd /opt/permit-signer
sed -i 's/^HMAC_PREVIOUS=.*/HMAC_PREVIOUS=/' .env.prod

# Restart container
docker-compose restart

# Verify only new HMAC works
# Old HMAC should now return 401 Unauthorized
```

### Rotation Schedule

**Recommended**: Rotate HMAC every 90 days

Add to crontab:
```bash
# Edit crontab
crontab -e

# Add rotation (every 90 days at 2 AM)
0 2 1 */3 * /opt/permit-signer/rotate-hmac.sh 60 >> /var/log/hmac-rotation.log 2>&1
```

---

## 7️⃣ Systemd Service (Optional)

For automatic restart on server reboot:

```bash
# Copy service file
sudo cp permit-signer.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable service
sudo systemctl enable permit-signer.service

# Start service
sudo systemctl start permit-signer.service

# Check status
sudo systemctl status permit-signer.service
```

---

## 8️⃣ Testing & Validation

### Test 1: Local Development

```bash
# Start local signer
cd signer-service
npm install
PORT=8787 node index.js

# Start Supabase functions locally
supabase functions serve

# Test execution
curl -X POST http://localhost:54321/functions/v1/onchain-execute \
     -H "Authorization: Bearer ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "chainId": 8453,
       "base": "WETH",
       "quote": "USDC",
       "side": "SELL",
       "amount": 0.001,
       "simulateOnly": true
     }'

# Expected: Permit2 signature generated successfully
```

### Test 2: Production Dry-Run

```bash
# Test safety guard: excessive sell amount
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/onchain-execute" \
     -H "Authorization: Bearer ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "chainId": 8453,
       "base": "WETH",
       "quote": "USDC",
       "side": "SELL",
       "amount": 1.0,
       "simulateOnly": true
     }'

# Expected: {"ok":false,"error":"sell_amount_too_large",...}

# Test safety guard: excessive slippage
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/onchain-execute" \
     -H "Authorization: Bearer ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "chainId": 8453,
       "base": "WETH",
       "quote": "USDC",
       "side": "SELL",
       "amount": 0.01,
       "slippageBps": 100,
       "simulateOnly": true
     }'

# Expected: {"ok":false,"error":"slippage_too_high",...}

# Test valid execution
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/onchain-execute" \
     -H "Authorization: Bearer ANON_KEY" \
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

# Expected: Successful response with permit2Data in notes
```

### Test 3: HMAC Rotation

```bash
# During grace period (both HMACs should work)
# Test with old HMAC
curl -H "Authorization: Bearer OLD_HMAC" \
     https://signer.yourdomain.com/healthz

# Test with new HMAC
curl -H "Authorization: Bearer NEW_HMAC" \
     https://signer.yourdomain.com/healthz

# Both should return: {"status":"ok",...}

# After grace period (only new HMAC should work)
curl -H "Authorization: Bearer OLD_HMAC" \
     https://signer.yourdomain.com/healthz
# Expected: {"error":"Unauthorized","message":"Invalid HMAC"}

curl -H "Authorization: Bearer NEW_HMAC" \
     https://signer.yourdomain.com/healthz
# Expected: {"status":"ok",...}
```

### Test 4: Firewall/IP Allowlist

```bash
# From non-allowed IP (should fail)
curl -H "Authorization: Bearer VALID_HMAC" \
     https://signer.yourdomain.com/version
# Expected: 403 Forbidden

# From Supabase IP (should succeed)
# Run this test from an Edge Function:
const response = await fetch('https://signer.yourdomain.com/version', {
  headers: { 'Authorization': 'Bearer YOUR_HMAC' }
});
# Expected: {"version":"1.1.0",...}
```

---

## 9️⃣ Monitoring & Logs

### Application Logs

```bash
# Container logs
docker-compose logs -f permit-signer

# Last 100 lines
docker-compose logs --tail=100 permit-signer

# Nginx access logs
sudo tail -f /var/log/nginx/permit-signer-access.log

# Nginx error logs
sudo tail -f /var/log/nginx/permit-signer-error.log
```

### Supabase Edge Function Logs

```bash
# View onchain-execute logs
supabase functions logs onchain-execute

# Stream live logs
supabase functions logs onchain-execute --follow

# Filter for permit2 events
supabase functions logs onchain-execute | grep permit2
```

### Health Checks

```bash
# Check container health
docker ps | grep permit-signer
# Should show: (healthy)

# Manual health check
curl http://127.0.0.1:8787/healthz

# Check from Nginx
curl https://signer.yourdomain.com/healthz
```

---

## 🔄 Rollback Procedures

### Rollback Signer Container

```bash
cd /opt/permit-signer

# List available tags/backups
docker images | grep permit-signer

# Stop current container
docker-compose down

# Restore previous .env.prod
cp backups/.env.prod.TIMESTAMP .env.prod

# Start with previous configuration
docker-compose up -d

# Verify rollback
docker-compose logs -f permit-signer
```

### Rollback Supabase Secrets

```bash
# Revert HMAC to previous value
supabase secrets set SIGNER_WEBHOOK_AUTH=PREVIOUS_HMAC

# Verify
supabase secrets list

# Redeploy edge functions if needed
supabase functions deploy onchain-execute
```

### Rollback Edge Function

```bash
# List previous deployments
git log --oneline supabase/functions/onchain-execute/

# Checkout previous version
git checkout PREVIOUS_COMMIT -- supabase/functions/onchain-execute/

# Redeploy
supabase functions deploy onchain-execute

# Verify
curl -X POST "https://YOUR_PROJECT.supabase.co/functions/v1/onchain-execute" \
     -H "Authorization: Bearer ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"chainId":8453,...}'
```

---

## 🛡️ Security Checklist

- [ ] Private key stored securely (never in git)
- [ ] HMAC secrets stored securely
- [ ] `.env.prod` has 600 permissions
- [ ] Container runs as non-root user
- [ ] Nginx IP allowlist configured with Supabase IPs
- [ ] SSL certificate valid and auto-renewing
- [ ] Firewall enabled (UFW)
- [ ] Container port (8787) only on localhost
- [ ] HMAC rotation scheduled
- [ ] Logs monitored for unauthorized access
- [ ] Safety guards (MAX_SELL_WEI, MAX_SLIPPAGE_BPS) configured
- [ ] Test both dry-run and live modes

---

## 📞 Troubleshooting

### Issue: 401 Unauthorized from Edge Function

**Solution**:
```bash
# Check HMAC in Supabase matches container
supabase secrets list | grep SIGNER_WEBHOOK_AUTH

# Check container env
docker-compose exec permit-signer env | grep HMAC_ACTIVE

# Update if mismatch
supabase secrets set SIGNER_WEBHOOK_AUTH=CORRECT_HMAC
```

### Issue: 403 Forbidden from Nginx

**Solution**:
```bash
# Check Nginx IP allowlist
sudo nano /etc/nginx/sites-available/permit-signer

# Add Supabase egress IPs
allow YOUR_SUPABASE_IP;

# Reload Nginx
sudo systemctl reload nginx
```

### Issue: Container Not Starting

**Solution**:
```bash
# Check logs
docker-compose logs permit-signer

# Common issues:
# 1. Missing env vars in .env.prod
# 2. Invalid private key format
# 3. Port 8787 already in use

# Kill any process on 8787
sudo lsof -ti:8787 | xargs kill -9

# Restart
docker-compose restart
```

### Issue: Safety Guard False Positive

**Solution**:
```bash
# Adjust limits in Supabase
supabase secrets set MAX_SELL_WEI=500000000000000000   # 0.5 ETH
supabase secrets set MAX_SLIPPAGE_BPS=100              # 1%

# Redeploy edge function
supabase functions deploy onchain-execute
```

---

## 📚 Additional Resources

- [Supabase Edge Functions Documentation](https://supabase.com/docs/guides/functions)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [UFW Documentation](https://help.ubuntu.com/community/UFW)

---

## 🎉 Success Criteria

Your deployment is successful when:

1. ✅ Container runs and passes health checks
2. ✅ HTTPS access works from Supabase IPs
3. ✅ Non-allowed IPs get 403 Forbidden
4. ✅ Edge function can sign Permit2 transactions
5. ✅ Safety guards reject oversized/high-slippage trades
6. ✅ HMAC rotation completes successfully
7. ✅ Logs show no unauthorized access attempts
8. ✅ Test trades execute successfully in simulateOnly mode
9. ✅ Rollback procedures tested and working
10. ✅ All team members have access to credentials and docs

---

**Deployment Date**: _____________  
**Deployed By**: _____________  
**Production URL**: _____________  
**HMAC Last Rotated**: _____________  

---

*For issues or questions, contact: your-team@example.com*
