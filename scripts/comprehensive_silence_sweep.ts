#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

// Comprehensive silence sweep to eliminate ALL console and toast violations
async function main() {
  console.log('🔥 COMPREHENSIVE SILENCE SWEEP: Starting...');
  
  const srcFiles = await glob('src/**/*.{ts,tsx}');
  const edgeFiles = await glob('supabase/functions/**/*.{ts,tsx}');
  
  // Exclude the two allowed logger files
  const excludePaths = [
    'src/utils/logger.ts',
    'supabase/functions/_shared/logger.ts',
    'src/components/ui/use-toast.ts',
    'src/components/ui/toast.tsx',
    'src/components/ui/sonner.tsx',
    'src/ui/ToastService.ts'
  ];
  
  const allFiles = [...srcFiles, ...edgeFiles].filter(file => 
    !excludePaths.some(exclude => file.endsWith(exclude))
  );
  
  let totalConsoleRemoved = 0;
  let totalToastRemoved = 0;
  let filesModified = 0;
  
  for (const file of allFiles) {
    let content = fs.readFileSync(file, 'utf8');
    const originalLength = content.length;
    
    // Count current violations before removal
    const consoleBefore = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
    const toastBefore = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
    
    // Remove console statements (preserve warn/error)
    content = content.replace(/console\.(log|info|debug|trace)\([^)]*\);?\s*/g, '');
    content = content.replace(/^\s*console\.(log|info|debug|trace)\(.*$/gm, '');
    
    // Remove toast imports and usage
    content = content.replace(/import.*\buseToast\b.*from.*;\s*/g, '');
    content = content.replace(/import.*\btoast\b.*from.*;\s*/g, '');
    content = content.replace(/from\s+["']sonner["']/g, 'from "sonner"');
    content = content.replace(/import\s*{[^}]*\buseToast\b[^}]*}\s*from[^;]*;\s*/g, '');
    content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
    content = content.replace(/\buseToast\(\)\s*;\s*/g, '');
    content = content.replace(/toast\(\s*{[^}]*}\s*\);\s*/g, '');
    content = content.replace(/<Toaster[^>]*\/?>\s*/g, '');
    content = content.replace(/\bshowToast\([^)]*\);\s*/g, '');
    
    // Clean up empty lines and imports
    content = content.replace(/^\s*$\n/gm, '');
    content = content.replace(/\n\n\n+/g, '\n\n');
    
    const consoleAfter = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
    const toastAfter = (content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || []).length;
    
    if (content.length !== originalLength) {
      fs.writeFileSync(file, content);
      filesModified++;
      
      const consoleRemoved = consoleBefore - consoleAfter;
      const toastRemoved = toastBefore - toastAfter;
      
      totalConsoleRemoved += consoleRemoved;
      totalToastRemoved += toastRemoved;
      
      console.log(`📁 ${file}: -${consoleRemoved} console, -${toastRemoved} toast`);
    }
  }
  
  console.log(`\n✅ SWEEP COMPLETE:`);
  console.log(`   Files modified: ${filesModified}`);
  console.log(`   Console calls removed: ${totalConsoleRemoved}`);
  console.log(`   Toast calls removed: ${totalToastRemoved}`);
  
  // Final verification scan
  console.log('\n🔍 VERIFICATION SCAN:');
  
  const verifyFiles = await glob('src/**/*.{ts,tsx}').then(files => 
    files.filter(f => !excludePaths.some(exclude => f.endsWith(exclude)))
  );
  const verifyEdgeFiles = await glob('supabase/functions/**/*.{ts,tsx}').then(files =>
    files.filter(f => !excludePaths.some(exclude => f.endsWith(exclude)))
  );
  
  let remainingConsole = 0;
  let remainingToast = 0;
  
  for (const file of [...verifyFiles, ...verifyEdgeFiles]) {
    const content = fs.readFileSync(file, 'utf8');
    const consoleMatches = content.match(/console\.(log|info|debug|trace)\(/g) || [];
    const toastMatches = content.match(/\btoast\(|\buseToast\(|<Toaster|\bshowToast\(/g) || [];
    
    remainingConsole += consoleMatches.length;
    remainingToast += toastMatches.length;
    
    if (consoleMatches.length > 0 || toastMatches.length > 0) {
      console.log(`❌ ${file}: ${consoleMatches.length} console, ${toastMatches.length} toast`);
    }
  }
  
  console.log(`\n📊 FINAL COUNT:`);
  console.log(`   Remaining console violations: ${remainingConsole}`);
  console.log(`   Remaining toast violations: ${remainingToast}`);
  
  if (remainingConsole === 0 && remainingToast === 0) {
    console.log('\n🎉 ALL VIOLATIONS ELIMINATED!');
    process.exit(0);
  } else {
    console.log('\n❌ VIOLATIONS STILL EXIST!');
    process.exit(1);
  }
}

main().catch(console.error);