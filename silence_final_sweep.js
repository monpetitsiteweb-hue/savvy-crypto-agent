#!/usr/bin/env node

const fs = require('fs');
const { glob } = require('glob');

// Comprehensive silence sweep - remove ALL violations
async function main() {
  console.log('🔥 FINAL SILENCE SWEEP: Starting comprehensive cleanup...');
  
  // Get all TypeScript/TSX files
  const srcFiles = glob.sync('src/**/*.{ts,tsx}');
  const edgeFiles = glob.sync('supabase/functions/**/*.{ts,tsx}');
  
  // Exclude protected files
  const excludes = [
    'src/utils/logger.ts',
    'supabase/functions/_shared/logger.ts',
    'src/components/ui/use-toast.ts',
    'src/components/ui/toast.tsx',
    'src/components/ui/sonner.tsx',
    'src/ui/ToastService.ts'
  ];
  
  const files = [...srcFiles, ...edgeFiles].filter(f => 
    !excludes.some(ex => f.endsWith(ex))
  );
  
  let totalConsole = 0;
  let totalToast = 0;
  let filesProcessed = 0;
  
  console.log(`📂 Processing ${files.length} files...`);
  
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    const originalLength = content.length;
    
    // Count current violations
    const consoleBefore = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
    const toastBefore = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
    
    // Remove console statements
    content = content.replace(/console\.(log|info|debug|trace)\([^;]*\);?\s*/g, '');
    content = content.replace(/^\s*console\.(log|info|debug|trace)\(.*$/gm, '');
    
    // Remove toast imports
    content = content.replace(/import\s+{[^}]*\buseToast\b[^}]*}\s+from[^;]+;\s*/g, '');
    content = content.replace(/import.*\btoast\b.*from.*;\s*/g, '');
    
    // Remove toast hook declarations
    content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
    content = content.replace(/\buseToast\(\)\s*;\s*/g, '');
    
    // Remove toast function calls
    content = content.replace(/toast\(\s*{[^}]*}\s*\);\s*/g, '// Toast removed');
    content = content.replace(/toast\([^)]*\);\s*/g, '// Toast removed');
    
    // Remove Toaster components
    content = content.replace(/<Toaster[^>]*\/?>[\s\S]*?<\/Toaster>?/g, '');
    content = content.replace(/<Toaster[^>]*\/?\s*>/g, '');
    
    // Remove showToast calls
    content = content.replace(/\bshowToast\([^)]*\);\s*/g, '');
    
    // Clean up empty lines
    content = content.replace(/^\s*$\n/gm, '');
    content = content.replace(/\n\n\n+/g, '\n\n');
    
    // Replace logger usage for console statements
    content = content.replace(/console\.error\(/g, 'logger.error(');
    content = content.replace(/console\.warn\(/g, 'logger.warn(');
    
    // Add logger import if needed and not present
    if ((content.includes('logger.error(') || content.includes('logger.warn(')) && 
        !content.includes('import') && !content.includes('logger') && 
        file.startsWith('src/')) {
      content = `import { logger } from '@/utils/logger';\n${content}`;
    }
    
    const consoleAfter = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
    const toastAfter = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
    
    if (content.length !== originalLength) {
      fs.writeFileSync(file, content);
      filesProcessed++;
      
      const consoleRemoved = consoleBefore - consoleAfter;
      const toastRemoved = toastBefore - toastAfter;
      
      totalConsole += consoleRemoved;
      totalToast += toastRemoved;
      
      if (consoleRemoved > 0 || toastRemoved > 0) {
        console.log(`📝 ${file}: -${consoleRemoved} console, -${toastRemoved} toast`);
      }
    }
  }
  
  console.log(`\n✅ SWEEP RESULTS:`);
  console.log(`   Files processed: ${filesProcessed}`);
  console.log(`   Console violations removed: ${totalConsole}`);
  console.log(`   Toast violations removed: ${totalToast}`);
  
  // Final verification
  console.log(`\n🔍 FINAL VERIFICATION:`);
  
  let remainingConsole = 0;
  let remainingToast = 0;
  const violators = [];
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const consoleViolations = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
    const toastViolations = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
    
    remainingConsole += consoleViolations;
    remainingToast += toastViolations;
    
    if (consoleViolations > 0 || toastViolations > 0) {
      violators.push(`${file}: ${consoleViolations} console, ${toastViolations} toast`);
    }
  }
  
  console.log(`   Remaining console violations: ${remainingConsole}`);
  console.log(`   Remaining toast violations: ${remainingToast}`);
  
  if (violators.length > 0) {
    console.log(`\n❌ REMAINING VIOLATORS:`);
    violators.forEach(v => console.log(`   ${v}`));
    process.exit(1);
  } else {
    console.log(`\n🎉 ALL VIOLATIONS ELIMINATED!`);
    process.exit(0);
  }
}

main().catch(console.error);