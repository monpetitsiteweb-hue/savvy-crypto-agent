#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Mass cleanup of all remaining console and toast violations
const files = [
  'src/**/*.{ts,tsx}',
  'supabase/functions/**/*.{ts,tsx}'
];

const excludePaths = [
  'src/utils/logger.ts',
  'supabase/functions/_shared/logger.ts',
  'src/components/ui/use-toast.ts',
  'src/components/ui/toaster.tsx',
  'src/components/ui/toast.tsx',
  'src/ui/ToastService.ts'
];

let totalRemoved = 0;

files.forEach(pattern => {
  const matches = glob.sync(pattern);
  matches.forEach(file => {
    if (excludePaths.some(exclude => file.endsWith(exclude))) return;
    
    let content = fs.readFileSync(file, 'utf8');
    const originalLength = content.length;
    
    // Remove console calls
    content = content.replace(/console\.(log|info|debug|trace)\([^)]*\);?\s*/g, '');
    content = content.replace(/console\.(log|info|debug|trace)\(\s*[^)]*\s*\);?\s*/gs, '');
    
    // Remove toast imports and calls
    content = content.replace(/import.*useToast.*from.*;\s*/g, '');
    content = content.replace(/import.*toast.*from.*;\s*/g, '');
    content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
    content = content.replace(/\btoast\(\s*{[^}]*}\s*\);\s*/gs, '');
    content = content.replace(/<Toaster[^>]*\/?>.*?<\/Toaster>?/gs, '');
    content = content.replace(/<Toaster[^>]*\/>/g, '');
    
    if (content.length !== originalLength) {
      fs.writeFileSync(file, content);
      totalRemoved += originalLength - content.length;
    }
  });
});

console.log(`✨ Silence Sweep Complete: ${totalRemoved} characters of violations removed`);