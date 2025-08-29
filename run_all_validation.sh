#!/bin/bash
set -e

echo "🚀 RUNNING COMPREHENSIVE VALIDATION SUITE"

# Step 1: Run final silence sweep
echo "📋 Step 1: Final silence sweep..."
node silence_final_sweep.js

# Step 2: Lint check
echo "📋 Step 2: Lint validation..."
npm run lint:strict 2>&1 | tee lint_results.log
LINT_WARNINGS=$(grep -c "warning" lint_results.log || echo "0")

# Step 3: Jest tests  
echo "📋 Step 3: Jest forbidden patterns test..."
npm test -- no-noise.test.ts 2>&1 | tee jest_results.log

# Step 4: Build validation
echo "📋 Step 4: Build validation..."
npm run build 2>&1 | tee build_results.log

# Step 5: Playwright validation
echo "📋 Step 5: Playwright validation..."
npm run serve &
SERVER_PID=$!
sleep 5

# Run production Playwright tests
PLAYWRIGHT_TEST_ENV=production npm run test:e2e 2>&1 | tee playwright_results.log
PLAYWRIGHT_EXIT=$?

# Cleanup server
kill $SERVER_PID 2>/dev/null || true

# Generate final report
echo ""
echo "📊 FINAL VALIDATION REPORT"
echo "=========================="

echo "🔍 Pattern violations:"
CONSOLE_VIOLATIONS=$(rg -n "console\.(log|info|debug|trace)\(" src supabase/functions --iglob '!src/utils/logger.ts' --iglob '!supabase/functions/_shared/logger.ts' | wc -l | tr -d ' ')
TOAST_VIOLATIONS=$(rg -n "\btoast\(|\buseToast\(|<Toaster|\bshowToast\(" src supabase/functions | wc -l | tr -d ' ')

echo "   Console violations: $CONSOLE_VIOLATIONS"
echo "   Toast violations: $TOAST_VIOLATIONS"

echo ""
echo "✅ Validation gates:"
echo "   Lint warnings: $LINT_WARNINGS"
echo "   Jest test: $(grep -q "PASS" jest_results.log && echo "PASSED" || echo "FAILED")"
echo "   Build: $(grep -q "built in" build_results.log && echo "PASSED" || echo "FAILED")"
echo "   Playwright: $([ $PLAYWRIGHT_EXIT -eq 0 ] && echo "PASSED" || echo "FAILED")"

if [ "$CONSOLE_VIOLATIONS" -eq 0 ] && [ "$TOAST_VIOLATIONS" -eq 0 ] && [ "$LINT_WARNINGS" -eq 0 ] && [ $PLAYWRIGHT_EXIT -eq 0 ]; then
  echo ""
  echo "🎉 ALL GATES PASSED - SILENCE SWEEP COMPLETE!"
  exit 0
else
  echo ""
  echo "❌ VALIDATION FAILED - review logs above"
  exit 1
fi