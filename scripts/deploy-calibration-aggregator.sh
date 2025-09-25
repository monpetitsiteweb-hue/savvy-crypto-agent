#!/bin/bash
set -euo pipefail

# Deploy calibration-aggregator function only
# Required environment variables:
# - SUPABASE_ACCESS_TOKEN: Your Supabase access token
# - SUPABASE_PROJECT_REF: Your Supabase project reference ID

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "Error: SUPABASE_ACCESS_TOKEN environment variable is required"
  exit 1
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "Error: SUPABASE_PROJECT_REF environment variable is required"
  exit 1
fi

echo "Deploying calibration-aggregator function..."
supabase functions deploy calibration-aggregator --project-ref "$SUPABASE_PROJECT_REF"
echo "✅ calibration-aggregator deployed successfully"