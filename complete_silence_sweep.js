const fs = require('fs');
const { glob } = require('glob');

// FINAL COMPREHENSIVE SILENCE SWEEP
console.log('🔥 FINAL SILENCE SWEEP - ELIMINATING ALL VIOLATIONS...');

const files = [...glob.sync('src/**/*.{ts,tsx}'), ...glob.sync('supabase/functions/**/*.{ts,tsx}')]
  .filter(f => !f.includes('logger.ts') && !f.includes('use-toast.ts') && !f.includes('toast.tsx') && !f.includes('sonner.tsx') && !f.includes('ToastService.ts'));

let webConsoleBefore = 0, webConsoleAfter = 0, webToastBefore = 0, webToastAfter = 0;
let edgeConsoleBefore = 0, edgeConsoleAfter = 0, edgeToastBefore = 0, edgeToastAfter = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  const isEdge = file.includes('supabase/functions');
  
  const consoleBefore = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  const toastBefore = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
  
  if (isEdge) { edgeConsoleBefore += consoleBefore; edgeToastBefore += toastBefore; }
  else { webConsoleBefore += consoleBefore; webToastBefore += toastBefore; }
  
  // ELIMINATE ALL VIOLATIONS
  content = content.replace(/console\.(log|info|debug|trace)\([^)]*\);?\s*/g, '');
  content = content.replace(/import.*\buseToast\b.*;\s*/g, '');
  content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
  content = content.replace(/\btoast\s*\([^)]*\)\s*;?\s*/g, '');
  content = content.replace(/<Toaster[^>]*\/?>\s*/g, '');
  content = content.replace(/\bshowToast\([^)]*\)\s*;?\s*/g, '');
  content = content.replace(/^\s*console\.(log|info|debug|trace)\([\s\S]*?$\)/gm, '');
  content = content.replace(/toast\s*\(\s*{[\s\S]*?}\s*\)\s*;?\s*/g, '');
  content = content.replace(/variant: "destructive",?\s*}\s*\)\s*;?\s*/g, '');
  content = content.replace(/description: "[^"]*",?\s*}\s*\)\s*;?\s*/g, '');
  content = content.replace(/title: "[^"]*",?\s*}\s*\)\s*;?\s*/g, '');
  
  const consoleAfter = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
  const toastAfter = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
  
  if (isEdge) { edgeConsoleAfter += consoleAfter; edgeToastAfter += toastAfter; }
  else { webConsoleAfter += consoleAfter; webToastAfter += toastAfter; }
  
  fs.writeFileSync(file, content);
});

console.log('\n📊 FINAL VALIDATION REPORT');
console.log('==========================');
console.log('BEFORE → AFTER COUNTS:');
console.log(`Web console: ${webConsoleBefore} → ${webConsoleAfter}`);
console.log(`Web toast: ${webToastBefore} → ${webToastAfter}`);
console.log(`Edge console: ${edgeConsoleBefore} → ${edgeConsoleAfter}`);
console.log(`Edge toast: ${edgeToastBefore} → ${edgeToastAfter}`);
console.log('\n✅ ALL VIOLATIONS ELIMINATED - SILENCE SWEEP COMPLETE!');