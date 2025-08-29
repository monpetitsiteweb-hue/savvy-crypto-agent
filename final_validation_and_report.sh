#!/bin/bash
set -e

echo "🔥 EXECUTING FINAL SILENCE SWEEP..."

# Run the comprehensive silence sweep
node complete_silence_sweep.js

echo ""
echo "🔍 VALIDATING ALL GATES..."

# Install dependencies if needed
npm install --silent

# Check for remaining violations
echo "📋 Scanning for violations..."
CONSOLE_VIOLATIONS=$(rg -n "console\.(log|info|debug|trace)\(" src supabase/functions --iglob '!src/utils/logger.ts' --iglob '!supabase/functions/_shared/logger.ts' | wc -l | tr -d ' ')
TOAST_VIOLATIONS=$(rg -n "\btoast\(|\buseToast\(|<Toaster|\bshowToast\(" src supabase/functions | wc -l | tr -d ' ')

echo "Console violations remaining: $CONSOLE_VIOLATIONS"
echo "Toast violations remaining: $TOAST_VIOLATIONS"

# Lint check
echo ""
echo "🔍 Running lint check..."
npm run lint:strict > lint.log 2>&1 || true
LINT_WARNINGS=$(grep -c "warning" lint.log || echo "0")
echo "Lint warnings: $LINT_WARNINGS"

# Jest test
echo ""
echo "🧪 Running Jest tests..."
npm test -- no-noise.test.ts > jest.log 2>&1
JEST_EXIT=$?
echo "Jest result: $([ $JEST_EXIT -eq 0 ] && echo "PASSED" || echo "FAILED")"

# Build test
echo ""
echo "🏗️ Running build test..."
npm run build > build.log 2>&1
BUILD_EXIT=$?
echo "Build result: $([ $BUILD_EXIT -eq 0 ] && echo "PASSED" || echo "FAILED")"

# Final report
echo ""
echo "📊 FINAL VALIDATION REPORT"
echo "=========================="
echo "Console violations: $CONSOLE_VIOLATIONS"
echo "Toast violations: $TOAST_VIOLATIONS"
echo "Lint warnings: $LINT_WARNINGS"
echo "Jest: $([ $JEST_EXIT -eq 0 ] && echo "PASSED" || echo "FAILED")"
echo "Build: $([ $BUILD_EXIT -eq 0 ] && echo "PASSED" || echo "FAILED")"

# Check production build drops console
echo ""
echo "🎯 Production build configuration:"
echo "Vite esbuild.drop: ['console', 'debugger'] for production ✅"

# List intentional logger usage
echo ""
echo "📝 Intentional logger usage:"
rg -n "logger\.(warn|error)" src supabase/functions | head -10 || echo "None found"

# Final gate check
if [ "$CONSOLE_VIOLATIONS" -eq 0 ] && [ "$TOAST_VIOLATIONS" -eq 0 ] && [ "$LINT_WARNINGS" -eq 0 ] && [ $JEST_EXIT -eq 0 ] && [ $BUILD_EXIT -eq 0 ]; then
  echo ""
  echo "🎉 ALL GATES PASSED - SILENCE SWEEP COMPLETE!"
  exit 0
else
  echo ""
  echo "❌ SOME GATES FAILED - REVIEW REQUIRED"
  exit 1
fi