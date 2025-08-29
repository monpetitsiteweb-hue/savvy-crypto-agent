#!/bin/bash
set -e

echo "🔥 STARTING COMPREHENSIVE SILENCE CLEANUP..."

# Step 1: Run comprehensive sweep
echo "📋 Step 1: Running comprehensive sweep..."
npx tsx scripts/comprehensive_silence_sweep.ts

# Step 2: Update pre-push hook
echo "📋 Step 2: Updating pre-push hook..."
mkdir -p .husky
cat > .husky/pre-push << 'EOF'
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Silence Gate - prevent pushing code with console noise or toast violations
echo "🔍 Running Silence Gate..."

# Check for console violations
if rg -n "console\.(log|info|debug|trace)\(" src supabase/functions --iglob '!src/utils/logger.ts' --iglob '!supabase/functions/_shared/logger.ts' | head -1; then
  echo "❌ Console violations found. Run: npm run silence:sweep"
  exit 1
fi

# Check for toast violations  
if rg -n "\btoast\(|\buseToast\(|<Toaster|\bshowToast\(" src supabase/functions | head -1; then
  echo "❌ Toast violations found. Run: npm run silence:sweep"
  exit 1
fi

echo "✅ Silence Gate passed"
EOF

chmod +x .husky/pre-push

# Step 3: Final verification scan
echo "📋 Step 3: Final verification scan..."

CONSOLE_VIOLATIONS=$(rg -n "console\.(log|info|debug|trace)\(" src supabase/functions --iglob '!src/utils/logger.ts' --iglob '!supabase/functions/_shared/logger.ts' | wc -l | tr -d ' ')
TOAST_VIOLATIONS=$(rg -n "\btoast\(|\buseToast\(|<Toaster|\bshowToast\(" src supabase/functions | wc -l | tr -d ' ')

echo "📊 FINAL SCAN RESULTS:"
echo "   Console violations: $CONSOLE_VIOLATIONS"
echo "   Toast violations: $TOAST_VIOLATIONS"

if [ "$CONSOLE_VIOLATIONS" -eq 0 ] && [ "$TOAST_VIOLATIONS" -eq 0 ]; then
  echo "✅ ALL VIOLATIONS ELIMINATED!"
else
  echo "❌ VIOLATIONS STILL EXIST - manual cleanup required"
  
  if [ "$CONSOLE_VIOLATIONS" -gt 0 ]; then
    echo "Console violations:"
    rg -n "console\.(log|info|debug|trace)\(" src supabase/functions --iglob '!src/utils/logger.ts' --iglob '!supabase/functions/_shared/logger.ts'
  fi
  
  if [ "$TOAST_VIOLATIONS" -gt 0 ]; then
    echo "Toast violations:"
    rg -n "\btoast\(|\buseToast\(|<Toaster|\bshowToast\(" src supabase/functions
  fi
  
  exit 1
fi

echo "🎉 COMPREHENSIVE CLEANUP COMPLETE!"