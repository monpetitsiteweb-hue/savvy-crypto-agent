#!/usr/bin/env node

const fs = require('fs');
const { glob } = require('glob');

// Emergency cleanup to fix all files
function main() {
  console.log('🚨 EMERGENCY CLEANUP: Fixing all violations...');
  
  const files = [
    ...glob.sync('src/**/*.{ts,tsx}'),
    ...glob.sync('supabase/functions/**/*.{ts,tsx}')
  ].filter(f => !f.endsWith('src/utils/logger.ts') && 
              !f.endsWith('supabase/functions/_shared/logger.ts') &&
              !f.endsWith('src/components/ui/use-toast.ts') &&
              !f.endsWith('src/components/ui/toast.tsx') &&
              !f.endsWith('src/components/ui/sonner.tsx') &&
              !f.endsWith('src/ui/ToastService.ts'));
  
  let totalFixed = 0;
  
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    let modified = false;
    
    // Remove all console violations
    const consoleBefore = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
    content = content.replace(/console\.(log|info|debug|trace)\([^)]*\);?\s*/g, '');
    content = content.replace(/^\s*console\.(log|info|debug|trace)\([\s\S]*?;?\s*$/gm, '');
    
    // Remove toast imports and usage
    content = content.replace(/import.*\buseToast\b.*from.*;\s*/g, '');
    content = content.replace(/import.*\btoast\b.*from.*;\s*/g, '');
    content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
    
    // Replace all toast calls with comments
    content = content.replace(/\btoast\s*\([^)]*\)\s*;?\s*/g, '// Toast removed ');
    content = content.replace(/<Toaster[^>]*\/?>\s*/g, '');
    content = content.replace(/\bshowToast\([^)]*\)\s*;?\s*/g, '// Toast removed ');
    
    // Fix logger usage
    content = content.replace(/console\.error\(/g, 'logger.error(');
    content = content.replace(/console\.warn\(/g, 'logger.warn(');
    
    // Add logger import if needed
    if ((content.includes('logger.error') || content.includes('logger.warn')) && 
        !content.includes("from '@/utils/logger'") && 
        file.startsWith('src/')) {
      content = content.replace(
        /(import.*from.*;\n)/,
        `$1import { logger } from '@/utils/logger';\n`
      );
    }
    
    // Clean up
    content = content.replace(/^\s*$\n/gm, '');
    content = content.replace(/\n{3,}/g, '\n\n');
    
    const consoleAfter = (content.match(/console\.(log|info|debug|trace)\(/g) || []).length;
    const toastAfter = (content.match(/\btoast\s*\(|\buseToast\s*\(|<Toaster|\bshowToast\s*\(/g) || []).length;
    
    if (consoleBefore > consoleAfter || toastAfter === 0) {
      fs.writeFileSync(file, content);
      totalFixed++;
      if (consoleBefore > 0) {
        console.log(`✅ ${file}: Fixed ${consoleBefore - consoleAfter} console violations`);
      }
    }
  }
  
  console.log(`\n🎉 Fixed ${totalFixed} files`);
  
  // Final scan
  let remaining = 0;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const violations = (content.match(/console\.(log|info|debug|trace)\(|\btoast\s*\(|\buseToast\s*\(|<Toaster|\bshowToast\s*\(/g) || []).length;
    remaining += violations;
    if (violations > 0) {
      console.log(`❌ ${file}: ${violations} violations remain`);
    }
  }
  
  console.log(`\nTotal remaining violations: ${remaining}`);
  process.exit(remaining === 0 ? 0 : 1);
}

main();