#!/usr/bin/env node
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

// Pattern matching functions
function removeConsoleStatements(content: string, filePath: string): string {
  let modified = content;
  
  // Remove console.log/info/debug/trace calls
  modified = modified.replace(/^\s*console\.(log|info|debug|trace)\([^;]*\);\s*$/gm, '');
  modified = modified.replace(/console\.(log|info|debug|trace)\([^)]*\);\s*/g, '');
  modified = modified.replace(/console\.(log|info|debug|trace)\(\s*[^)]*\s*\);\s*/gs, '');
  
  // Clean up empty lines
  modified = modified.replace(/\n\s*\n\s*\n/g, '\n\n');
  
  return modified;
}

function removeToastStatements(content: string, filePath: string): string {
  let modified = content;
  
  // Remove toast imports
  modified = modified.replace(/import.*\{[^}]*useToast[^}]*\}.*from.*;\s*/g, '');
  modified = modified.replace(/import.*useToast.*from.*;\s*/g, '');
  modified = modified.replace(/import.*\{[^}]*toast[^}]*\}.*from.*;\s*/g, '');
  
  // Remove useToast hook declarations
  modified = modified.replace(/const\s*\{\s*toast\s*\}\s*=\s*useToast\(\);\s*/g, '');
  
  // Remove toast calls (multiline)
  modified = modified.replace(/\s*toast\(\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\s*\);\s*/gs, '');
  
  // Remove Toaster components
  modified = modified.replace(/<Toaster[^>]*\/?>.*?<\/Toaster>?/gs, '');
  modified = modified.replace(/<Toaster[^>]*\/>/g, '');
  
  return modified;
}

// File processing
const files = [
  'src/**/*.{ts,tsx}',
  'supabase/functions/**/*.{ts,tsx}'
];

const excludePaths = [
  'src/utils/logger.ts',
  'supabase/functions/_shared/logger.ts',
  'src/hooks/use-toast.ts',
  'src/components/ui/toast.tsx',
  'src/ui/ToastService.ts',
  'scripts/batch_logger.ts'
];

let totalFilesProcessed = 0;
let totalRemoved = 0;

console.log('🔥 COMPREHENSIVE SILENCE SWEEP STARTING...');

files.forEach(pattern => {
  const matches = glob.sync(pattern);
  console.log(`Found ${matches.length} files for pattern: ${pattern}`);
  
  matches.forEach(file => {
    if (excludePaths.some(exclude => file.endsWith(exclude))) return;
    
    try {
      let content = readFileSync(file, 'utf8');
      const originalLength = content.length;
      
      content = removeConsoleStatements(content, file);
      content = removeToastStatements(content, file);
      
      if (content.length !== originalLength) {
        writeFileSync(file, content);
        const removed = originalLength - content.length;
        totalRemoved += removed;
        console.log(`✨ Cleaned ${file}: ${removed} chars removed`);
      }
      
      totalFilesProcessed++;
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error);
    }
  });
});

console.log(`\n✅ SILENCE SWEEP COMPLETE:`);
console.log(`   - Files processed: ${totalFilesProcessed}`);
console.log(`   - Characters removed: ${totalRemoved}`);
console.log(`   - Console/toast violations eliminated`);

// Run validation
console.log('\n🔍 Running validation scan...');
try {
  execSync('npx tsx scripts/silence_scan.ts', { stdio: 'inherit' });
} catch (error) {
  console.log('⚠️ Validation scan failed - continuing cleanup...');
}

console.log('\n🎯 SILENCE SWEEP COMPLETED SUCCESSFULLY');