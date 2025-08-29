#!/bin/bash
set -e

echo "🔥 EXECUTING COMPREHENSIVE SILENCE SWEEP..."

# Run the comprehensive sweep
npx tsx scripts/comprehensive_silence_sweep.ts

echo "✅ COMPREHENSIVE SILENCE SWEEP COMPLETE"
echo "📋 Running validation tests..."

# Install dependencies
npm install

# Run all validation gates
echo "🔍 Lint check..."
npm run lint:strict

echo "🧪 Jest tests..."
npm test -- no-noise.test.ts

echo "🏗️ Build check..."
npm run build

echo "🎭 Playwright tests..."
npm run serve &
SERVER_PID=$!
sleep 3
PLAYWRIGHT_TEST_ENV=production npm run test:e2e
kill $SERVER_PID

echo "🎉 ALL GATES PASSED!"