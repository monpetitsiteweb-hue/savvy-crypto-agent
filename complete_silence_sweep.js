const fs = require('fs');
const { glob } = require('glob');

// ULTRA COMPREHENSIVE SILENCE SWEEP - ELIMINATE ALL VIOLATIONS
const files = [...glob.sync('src/**/*.{ts,tsx}'), ...glob.sync('supabase/functions/**/*.{ts,tsx}')]
  .filter(f => !f.includes('logger.ts') && !f.includes('use-toast.ts') && !f.includes('toast.tsx') && !f.includes('sonner.tsx') && !f.includes('ToastService.ts'));

let webConsoleBefore = 0, webConsoleAfter = 0, webToastBefore = 0, webToastAfter = 0;
let edgeConsoleBefore = 0, edgeConsoleAfter = 0, edgeToastBefore = 0, edgeToastAfter = 0;
let filesProcessed = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;
  const isEdge = file.includes('supabase/functions');
  
  const consoleBefore = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  const toastBefore = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
  
  if (isEdge) { edgeConsoleBefore += consoleBefore; edgeToastBefore += toastBefore; }
  else { webConsoleBefore += consoleBefore; webToastBefore += toastBefore; }
  
  // ULTRA AGGRESSIVE VIOLATION ELIMINATION
  // Remove all console violations
  content = content.replace(/console\.(log|info|debug|trace)\([^)]*\);\s*/g, '');
  content = content.replace(/^\s*console\.(log|info|debug|trace)\(.*$/gm, '');
  content = content.replace(/console\.(log|info|debug|trace)\(\s*[^)]*\s*\);\s*/gs, '');
  content = content.replace(/console\.(log|info|debug|trace)\([^;]*;/g, '');
  
  // Remove all toast violations
  content = content.replace(/import.*\{[^}]*useToast[^}]*\}.*from.*;\s*/g, '');
  content = content.replace(/import.*useToast.*from.*;\s*/g, '');
  content = content.replace(/import.*\{[^}]*toast[^}]*\}.*from.*;\s*/g, '');
  content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
  content = content.replace(/\btoast\(\s*{[^}]*}\s*\);\s*/gs, '');
  content = content.replace(/toast\(\s*{[^}]*}\s*\);\s*/gs, '');
  content = content.replace(/<Toaster[^>]*\/?>.*?<\/Toaster>?/gs, '');
  content = content.replace(/<Toaster[^>]*\/>/g, '');
  content = content.replace(/\bshowToast\([^)]*\)\s*;?\s*/g, '');
  
  // Clean up multiline toast calls
  content = content.replace(/toast\s*\(\s*{\s*title:[\s\S]*?}\s*\)\s*;?\s*/g, '');
  content = content.replace(/toast\s*\(\s*{\s*description:[\s\S]*?}\s*\)\s*;?\s*/g, '');
  content = content.replace(/toast\s*\(\s*{\s*variant:[\s\S]*?}\s*\)\s*;?\s*/g, '');
  
  // Remove orphaned properties
  content = content.replace(/title: "[^"]*",?\s*description: "[^"]*",?\s*variant: "[^"]*",?\s*}\s*\)\s*;?\s*/g, '');
  content = content.replace(/variant: "destructive",?\s*}\s*\)\s*;?\s*/g, '');
  
  // Clean empty lines
  content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
  
  const consoleAfter = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  const toastAfter = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
  
  if (isEdge) { edgeConsoleAfter += consoleAfter; edgeToastAfter += toastAfter; }
  else { webConsoleAfter += consoleAfter; webToastAfter += toastAfter; }
  
  if (content !== original) {
    fs.writeFileSync(file, content);
    filesProcessed++;
  }
});

console.log('📊 FINAL VALIDATION REPORT');
console.log('==========================');
console.log('BEFORE → AFTER COUNTS:');
console.log(`Web console violations: ${webConsoleBefore} → ${webConsoleAfter}`);
console.log(`Web toast violations: ${webToastBefore} → ${webToastAfter}`);
console.log(`Edge console violations: ${edgeConsoleBefore} → ${edgeConsoleAfter}`);
console.log(`Edge toast violations: ${edgeToastBefore} → ${edgeToastAfter}`);
console.log(`Files processed: ${filesProcessed}`);

if (webConsoleAfter === 0 && webToastAfter === 0 && edgeConsoleAfter === 0 && edgeToastAfter === 0) {
  console.log('\n✅ SILENCE SWEEP COMPLETE - ALL VIOLATIONS ELIMINATED');
  process.exit(0);
} else {
  console.log('\n❌ VIOLATIONS REMAIN - ADDITIONAL CLEANUP NEEDED');
  process.exit(1);
}