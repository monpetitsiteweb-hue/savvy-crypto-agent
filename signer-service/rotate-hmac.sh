#!/bin/bash
# HMAC Rotation Script for permit-signer
# Usage: ./rotate-hmac.sh [grace-period-minutes]

set -euo pipefail

GRACE_PERIOD_MIN=${1:-60}
ENV_FILE="/opt/permit-signer/.env.prod"
BACKUP_DIR="/opt/permit-signer/backups"

echo "🔄 HMAC Rotation Script"
echo "Grace period: ${GRACE_PERIOD_MIN} minutes"
echo ""

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Backup current .env file
BACKUP_FILE="${BACKUP_DIR}/.env.prod.$(date +%Y%m%d_%H%M%S)"
cp "$ENV_FILE" "$BACKUP_FILE"
echo "✅ Backed up current config to: $BACKUP_FILE"

# Generate new HMAC (64 random hex characters)
NEW_HMAC=$(openssl rand -hex 32)
echo "✅ Generated new HMAC"

# Read current HMAC_ACTIVE
if [ -f "$ENV_FILE" ]; then
    CURRENT_ACTIVE=$(grep "^HMAC_ACTIVE=" "$ENV_FILE" | cut -d'=' -f2 || echo "")
else
    echo "❌ Error: $ENV_FILE not found"
    exit 1
fi

if [ -z "$CURRENT_ACTIVE" ]; then
    echo "❌ Error: HMAC_ACTIVE not found in $ENV_FILE"
    exit 1
fi

echo "Current HMAC_ACTIVE: ${CURRENT_ACTIVE:0:8}..."

# Update .env file
# 1. Move current HMAC_ACTIVE to HMAC_PREVIOUS
# 2. Set new HMAC_ACTIVE
sed -i.bak \
    -e "s/^HMAC_ACTIVE=.*/HMAC_ACTIVE=${NEW_HMAC}/" \
    -e "s/^HMAC_PREVIOUS=.*/HMAC_PREVIOUS=${CURRENT_ACTIVE}/" \
    "$ENV_FILE"

echo "✅ Updated $ENV_FILE"
echo "   HMAC_ACTIVE:   ${NEW_HMAC:0:8}..."
echo "   HMAC_PREVIOUS: ${CURRENT_ACTIVE:0:8}..."

# Restart the service
echo ""
echo "🔄 Restarting permit-signer service..."
cd /opt/permit-signer
docker-compose restart

echo ""
echo "✅ HMAC rotation complete!"
echo ""
echo "⏰ Grace period: Both HMACs are now valid for ${GRACE_PERIOD_MIN} minutes"
echo ""
echo "📋 Next steps:"
echo "   1. Update Supabase secrets with new HMAC:"
echo "      supabase secrets set SIGNER_WEBHOOK_AUTH=${NEW_HMAC}"
echo ""
echo "   2. Wait ${GRACE_PERIOD_MIN} minutes for grace period"
echo ""
echo "   3. Remove HMAC_PREVIOUS from $ENV_FILE:"
echo "      sed -i 's/^HMAC_PREVIOUS=.*/HMAC_PREVIOUS=/' $ENV_FILE"
echo "      docker-compose restart"
echo ""
echo "   4. Verify access logs to ensure no 401 errors"
echo ""

# Schedule grace period cleanup reminder
echo "⏰ Setting up grace period cleanup reminder..."
CLEANUP_TIME=$(date -d "+${GRACE_PERIOD_MIN} minutes" "+%Y-%m-%d %H:%M:%S")
echo "#!/bin/bash" > "${BACKUP_DIR}/cleanup_reminder.sh"
echo "echo '⚠️  HMAC grace period expired at ${CLEANUP_TIME}'" >> "${BACKUP_DIR}/cleanup_reminder.sh"
echo "echo 'Run: sed -i \"s/^HMAC_PREVIOUS=.*/HMAC_PREVIOUS=/\" $ENV_FILE && cd /opt/permit-signer && docker-compose restart'" >> "${BACKUP_DIR}/cleanup_reminder.sh"
chmod +x "${BACKUP_DIR}/cleanup_reminder.sh"

# Optional: Schedule with at command if available
if command -v at &> /dev/null; then
    echo "${BACKUP_DIR}/cleanup_reminder.sh" | at now + ${GRACE_PERIOD_MIN} minutes 2>/dev/null || true
    echo "✅ Scheduled cleanup reminder via 'at' command"
fi

echo ""
echo "🎉 Done! Monitor logs: docker-compose logs -f permit-signer"
