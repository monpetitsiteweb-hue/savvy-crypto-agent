#!/bin/bash
# Firewall Setup Script for permit-signer
# Run with sudo

set -e

echo "🔥 Setting up firewall for permit-signer"

# Install UFW if not present
if ! command -v ufw &> /dev/null; then
    echo "Installing UFW..."
    apt-get update
    apt-get install -y ufw
fi

# Reset UFW to default
echo "Resetting UFW to default..."
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (CRITICAL - don't lock yourself out!)
ufw allow 22/tcp comment 'SSH'

# Allow HTTP/HTTPS
ufw allow 80/tcp comment 'HTTP for Let\'s Encrypt'
ufw allow 443/tcp comment 'HTTPS'

# Enable UFW
echo "Enabling UFW..."
ufw --force enable

# Show status
echo ""
echo "✅ Firewall configured successfully!"
echo ""
ufw status verbose

echo ""
echo "📋 Important notes:"
echo "   - Port 8787 (signer) is only accessible via localhost (127.0.0.1)"
echo "   - Nginx enforces IP allowlist for Supabase egress IPs"
echo "   - All other IPs will get 403 Forbidden from Nginx"
echo ""
echo "🔧 Next steps:"
echo "   1. Update nginx.conf with your Supabase egress IPs"
echo "   2. Test access from Supabase: curl https://signer.yourdomain.com/healthz"
echo "   3. Verify firewall: sudo ufw status verbose"
