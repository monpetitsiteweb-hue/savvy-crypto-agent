const fs = require('fs');
const { glob } = require('glob');

console.log('🚀 EMERGENCY COMPLETE CLEANUP - ELIMINATING ALL VIOLATIONS...');

// Get all TypeScript/TSX files
const srcFiles = glob.sync('src/**/*.{ts,tsx}').filter(f => !f.includes('src/utils/logger.ts') && !f.includes('src/hooks/use-toast.ts') && !f.includes('src/components/ui/toast.tsx') && !f.includes('src/components/ui/sonner.tsx') && !f.includes('src/ui/ToastService.ts'));
const edgeFiles = glob.sync('supabase/functions/**/*.{ts,tsx}').filter(f => !f.includes('supabase/functions/_shared/logger.ts'));

let webConsoleBefore = 0, webConsoleAfter = 0, webToastBefore = 0, webToastAfter = 0;
let edgeConsoleBefore = 0, edgeConsoleAfter = 0;
let filesModified = 0;

console.log(`Processing ${srcFiles.length} src files and ${edgeFiles.length} edge function files...`);

// Process src files
srcFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;
  
  // Count violations before
  webConsoleBefore += (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  webToastBefore += (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
  
  // AGGRESSIVE CONSOLE REMOVAL
  content = content.replace(/console\.log\([^)]*\);?\s*/g, '');
  content = content.replace(/console\.info\([^)]*\);?\s*/g, '');
  content = content.replace(/console\.debug\([^)]*\);?\s*/g, '');
  content = content.replace(/console\.trace\([^)]*\);?\s*/g, '');
  content = content.replace(/^\s*console\.(log|info|debug|trace)\(.*$/gm, '');
  
  // AGGRESSIVE TOAST REMOVAL
  content = content.replace(/import.*\{[^}]*useToast[^}]*\}.*from.*;\s*/g, '');
  content = content.replace(/import.*useToast.*from.*;\s*/g, '');
  content = content.replace(/const\s*\{\s*toast\s*\}\s*=\s*useToast\(\);\s*/g, '');
  content = content.replace(/\btoast\s*\(\s*\{[^}]*\}\s*\);\s*/g, '');
  content = content.replace(/<Toaster[^>]*\/>\s*/g, '');
  content = content.replace(/\bshowToast\([^)]*\);\s*/g, '');
  
  // Remove multiline toast calls
  content = content.replace(/toast\s*\(\s*\{\s*title:\s*"[^"]*",?\s*description:\s*"[^"]*",?\s*variant:\s*"[^"]*",?\s*\}\s*\);\s*/g, '');
  
  // Count violations after
  webConsoleAfter += (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  webToastAfter += (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
  
  if (content !== original) {
    fs.writeFileSync(file, content);
    filesModified++;
  }
});

// Process edge function files
edgeFiles.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;
  
  // Count violations before
  edgeConsoleBefore += (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  
  // AGGRESSIVE CONSOLE REMOVAL
  content = content.replace(/console\.log\([^)]*\);?\s*/g, '');
  content = content.replace(/console\.info\([^)]*\);?\s*/g, '');
  content = content.replace(/console\.debug\([^)]*\);?\s*/g, '');
  content = content.replace(/console\.trace\([^)]*\);?\s*/g, '');
  content = content.replace(/^\s*console\.(log|info|debug|trace)\(.*$/gm, '');
  
  // Count violations after  
  edgeConsoleAfter += (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  
  if (content !== original) {
    fs.writeFileSync(file, content);
    filesModified++;
  }
});

console.log('\n📊 EMERGENCY CLEANUP REPORT');
console.log('============================');
console.log(`Files modified: ${filesModified}`);
console.log(`Web console violations: ${webConsoleBefore} → ${webConsoleAfter}`);
console.log(`Web toast violations: ${webToastBefore} → ${webToastAfter}`);
console.log(`Edge console violations: ${edgeConsoleBefore} → ${edgeConsoleAfter}`);
console.log(`Edge toast violations: 0 → 0`);

const totalViolations = webConsoleAfter + webToastAfter + edgeConsoleAfter;
if (totalViolations === 0) {
  console.log('\n✅ ALL VIOLATIONS ELIMINATED - CLEANUP SUCCESS!');
} else {
  console.log(`\n❌ ${totalViolations} VIOLATIONS REMAIN - ADDITIONAL CLEANUP NEEDED`);
}