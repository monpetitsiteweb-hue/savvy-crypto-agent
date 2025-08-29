#!/bin/bash
set -e

echo "🚀 VALIDATING ALL GATES..."

# Run emergency cleanup first
echo "Step 1: Emergency cleanup..."
node emergency_cleanup.js

# Check violations
echo "Step 2: Scanning for violations..."
CONSOLE_COUNT=$(rg -n "console\.(log|info|debug|trace)\(" src supabase/functions --iglob '!src/utils/logger.ts' --iglob '!supabase/functions/_shared/logger.ts' | wc -l | tr -d ' ')
TOAST_COUNT=$(rg -n "\btoast\(|\buseToast\(|<Toaster|\bshowToast\(" src supabase/functions | wc -l | tr -d ' ')

echo "Console violations: $CONSOLE_COUNT"  
echo "Toast violations: $TOAST_COUNT"

# Lint
echo "Step 3: Lint check..."
npm run lint:strict > lint.log 2>&1 || true
LINT_WARNINGS=$(grep -c "warning" lint.log || echo "0")
echo "Lint warnings: $LINT_WARNINGS"

# Jest
echo "Step 4: Jest test..."
npm test -- no-noise.test.ts > jest.log 2>&1
JEST_PASS=$(grep -c "PASS" jest.log || echo "0")
echo "Jest result: $([ $JEST_PASS -gt 0 ] && echo "PASSED" || echo "FAILED")"

# Build  
echo "Step 5: Build test..."
npm run build > build.log 2>&1
BUILD_SUCCESS=$(grep -c "built in" build.log || echo "0")
echo "Build result: $([ $BUILD_SUCCESS -gt 0 ] && echo "PASSED" || echo "FAILED")"

# Playwright
echo "Step 6: Playwright test..."
npm run serve &
SERVER_PID=$!
sleep 5
PLAYWRIGHT_TEST_ENV=production npm run test:e2e > playwright.log 2>&1
PLAYWRIGHT_EXIT=$?
kill $SERVER_PID

echo ""
echo "📊 FINAL VALIDATION REPORT"
echo "=========================="
echo "Console violations: $CONSOLE_COUNT"
echo "Toast violations: $TOAST_COUNT"  
echo "Lint warnings: $LINT_WARNINGS"
echo "Jest: $([ $JEST_PASS -gt 0 ] && echo "PASSED" || echo "FAILED")"
echo "Build: $([ $BUILD_SUCCESS -gt 0 ] && echo "PASSED" || echo "FAILED")"
echo "Playwright: $([ $PLAYWRIGHT_EXIT -eq 0 ] && echo "PASSED" || echo "FAILED")"

# Intentional logger usage
echo ""
echo "📝 Intentional logger usage:"
rg -n "logger\.(warn|error)" src supabase/functions | head -5

if [ "$CONSOLE_COUNT" -eq 0 ] && [ "$TOAST_COUNT" -eq 0 ] && [ "$LINT_WARNINGS" -eq 0 ] && [ $JEST_PASS -gt 0 ] && [ $BUILD_SUCCESS -gt 0 ] && [ $PLAYWRIGHT_EXIT -eq 0 ]; then
  echo ""
  echo "🎉 ALL GATES PASSED!"
  exit 0
else
  echo ""
  echo "❌ VALIDATION FAILED"
  exit 1
fi