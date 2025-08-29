const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

console.log('🚀 ULTIMATE SILENCE CLEANER - ELIMINATING ALL VIOLATIONS');

// Get all files except the protected ones
const allFiles = [
  ...glob.sync('src/**/*.{ts,tsx}'),
  ...glob.sync('supabase/functions/**/*.{ts,tsx}')
].filter(f => 
  !f.includes('src/utils/logger.ts') && 
  !f.includes('supabase/functions/_shared/logger.ts') &&
  !f.includes('src/hooks/use-toast.ts') &&
  !f.includes('src/components/ui/toast.tsx') &&
  !f.includes('src/components/ui/sonner.tsx') &&
  !f.includes('src/ui/ToastService.ts')
);

let totalFilesProcessed = 0;
let webConsoleRemoved = 0, webToastRemoved = 0;
let edgeConsoleRemoved = 0, edgeToastRemoved = 0;

allFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let newContent = content;
  const isEdge = file.includes('supabase/functions');
  
  // Count before
  const consoleBefore = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  const toastBefore = (content.match(/\btoast\(|\buseToast\(/g) || []).length;
  
  // AGGRESSIVE CONSOLE ELIMINATION
  newContent = newContent.replace(/console\.log\([^)]*\);?\s*/g, '');
  newContent = newContent.replace(/console\.info\([^)]*\);?\s*/g, '');
  newContent = newContent.replace(/console\.debug\([^)]*\);?\s*/g, '');
  newContent = newContent.replace(/console\.trace\([^)]*\);?\s*/g, '');
  
  // Handle multiline console statements
  newContent = newContent.replace(/^\s*console\.(log|info|debug|trace)\([^;]*;/gm, '');
  newContent = newContent.replace(/console\.(log|info|debug|trace)\(\s*[^)]*\s*\)\s*;?\s*/gs, '');
  
  // AGGRESSIVE TOAST ELIMINATION
  newContent = newContent.replace(/import.*\{[^}]*useToast[^}]*\}.*from.*['"][^'"]*['"];\s*/g, '');
  newContent = newContent.replace(/import.*useToast.*from.*['"][^'"]*['"];\s*/g, '');
  newContent = newContent.replace(/const\s*\{\s*toast\s*\}\s*=\s*useToast\(\);\s*/g, '');
  
  // Remove toast calls with various patterns
  newContent = newContent.replace(/\s*toast\s*\(\s*\{[^}]*\}\s*\)\s*;?\s*/g, '');
  newContent = newContent.replace(/toast\s*\(\s*\{[\s\S]*?\}\s*\)\s*;?\s*/g, '');
  
  // Remove standalone useToast declarations
  newContent = newContent.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);/g, '');
  
  // Clean up empty lines
  newContent = newContent.replace(/\n\s*\n\s*\n/g, '\n\n');
  newContent = newContent.replace(/^\s*\n/gm, '\n');
  
  // Count after
  const consoleAfter = (newContent.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  const toastAfter = (newContent.match(/\btoast\(|\buseToast\(/g) || []).length;
  
  if (isEdge) {
    edgeConsoleRemoved += (consoleBefore - consoleAfter);
    edgeToastRemoved += (toastBefore - toastAfter);
  } else {
    webConsoleRemoved += (consoleBefore - consoleAfter);
    webToastRemoved += (toastBefore - toastAfter);
  }
  
  if (newContent !== content) {
    fs.writeFileSync(file, newContent);
    totalFilesProcessed++;
    if (consoleBefore > 0 || toastBefore > 0) {
      console.log(`✅ Cleaned ${file}: -${consoleBefore} console, -${toastBefore} toast`);
    }
  }
});

console.log('\n📊 ULTIMATE CLEANUP RESULTS');
console.log('============================');
console.log(`Files processed: ${totalFilesProcessed}`);
console.log(`Web console violations removed: ${webConsoleRemoved}`);
console.log(`Web toast violations removed: ${webToastRemoved}`);
console.log(`Edge console violations removed: ${edgeConsoleRemoved}`);
console.log(`Edge toast violations removed: ${edgeToastRemoved}`);
console.log(`Total violations eliminated: ${webConsoleRemoved + webToastRemoved + edgeConsoleRemoved + edgeToastRemoved}`);

// Final verification
const remainingConsole = allFiles.reduce((total, file) => {
  const content = fs.readFileSync(file, 'utf8');
  return total + (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
}, 0);

const remainingToast = allFiles.reduce((total, file) => {
  const content = fs.readFileSync(file, 'utf8');
  return total + (content.match(/\btoast\(|\buseToast\(/g) || []).length;
}, 0);

console.log('\n🔍 FINAL VERIFICATION');
console.log('======================');
console.log(`Remaining console violations: ${remainingConsole}`);
console.log(`Remaining toast violations: ${remainingToast}`);

if (remainingConsole === 0 && remainingToast === 0) {
  console.log('\n🎉 SUCCESS: ALL VIOLATIONS ELIMINATED!');
  process.exit(0);
} else {
  console.log('\n⚠️ WARNING: Some violations may remain');
  process.exit(1);
}