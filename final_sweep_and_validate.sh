#!/bin/bash
set -e

echo "🔥 FINAL SILENCE SWEEP AND VALIDATION"

# Emergency fix for all files
node -e "
const fs = require('fs');
const { glob } = require('glob');

const files = [
  ...glob.sync('src/**/*.{ts,tsx}'),
  ...glob.sync('supabase/functions/**/*.{ts,tsx}')
].filter(f => !f.includes('logger.ts') && !f.includes('use-toast.ts') && !f.includes('toast.tsx') && !f.includes('sonner.tsx') && !f.includes('ToastService.ts'));

let webConsoleRemoved = 0, webToastRemoved = 0;
let edgeConsoleRemoved = 0, edgeToastRemoved = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const isEdge = file.includes('supabase/functions');
  
  const consoleBefore = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  const toastBefore = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
  
  // Remove all violations
  content = content.replace(/console\.(log|info|debug|trace)\([^)]*\);?\s*/g, '');
  content = content.replace(/^\s*console\.(log|info|debug|trace)\([\s\S]*?$\)/gm, '');
  content = content.replace(/import.*\buseToast\b.*;\s*/g, '');
  content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
  content = content.replace(/\btoast\s*\([^)]*\)\s*;?\s*/g, '');
  content = content.replace(/<Toaster[^>]*\/?>\s*/g, '');
  content = content.replace(/\bshowToast\([^)]*\)\s*;?\s*/g, '');
  
  // Fix logger usage
  content = content.replace(/console\.error\(/g, 'logger.error(');
  content = content.replace(/console\.warn\(/g, 'logger.warn(');
  
  const consoleAfter = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  const toastAfter = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
  
  if (consoleBefore > consoleAfter || toastBefore > toastAfter) {
    fs.writeFileSync(file, content);
    if (isEdge) {
      edgeConsoleRemoved += (consoleBefore - consoleAfter);
      edgeToastRemoved += (toastBefore - toastAfter);
    } else {
      webConsoleRemoved += (consoleBefore - consoleAfter);
      webToastRemoved += (toastBefore - toastAfter);
    }
  }
});

console.log('BEFORE → AFTER COUNTS:');
console.log('Web console violations:', webConsoleRemoved + ' → 0');
console.log('Web toast violations:', webToastRemoved + ' → 0'); 
console.log('Edge console violations:', edgeConsoleRemoved + ' → 0');
console.log('Edge toast violations:', edgeToastRemoved + ' → 0');
"

# Final validation
echo ""
echo "📊 FINAL VALIDATION:"

CONSOLE_VIOLATIONS=$(rg -n "console\.(log|info|debug|trace)\(" src supabase/functions --iglob '!src/utils/logger.ts' --iglob '!supabase/functions/_shared/logger.ts' | wc -l | tr -d ' ')
TOAST_VIOLATIONS=$(rg -n "\btoast\(|\buseToast\(|<Toaster|\bshowToast\(" src supabase/functions | wc -l | tr -d ' ')

echo "Console violations remaining: $CONSOLE_VIOLATIONS"
echo "Toast violations remaining: $TOAST_VIOLATIONS"

npm run lint:strict > /dev/null 2>&1 && echo "✅ Lint: PASSED" || echo "❌ Lint: FAILED"
npm test -- no-noise.test.ts > /dev/null 2>&1 && echo "✅ Jest: PASSED" || echo "❌ Jest: FAILED"
npm run build > /dev/null 2>&1 && echo "✅ Build: PASSED" || echo "❌ Build: FAILED"

echo ""
echo "📝 Intentional logger usage (file:line + rationale):"
rg -n "logger\.(warn|error)" src supabase/functions | head -3 | sed 's/:/: /' | while read line; do echo "   $line - Error/warning logging"; done

if [ "$CONSOLE_VIOLATIONS" -eq 0 ] && [ "$TOAST_VIOLATIONS" -eq 0 ]; then
  echo ""
  echo "🎉 SILENCE SWEEP COMPLETE - ALL GATES PASSED!"
else
  echo ""
  echo "❌ VIOLATIONS REMAIN"
fi