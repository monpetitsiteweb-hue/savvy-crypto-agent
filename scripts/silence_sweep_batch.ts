#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { logger } from './batch_logger';

// Mass cleanup of all remaining console and toast violations
const files = [
  'src/**/*.{ts,tsx}',
  'supabase/functions/**/*.{ts,tsx}'
];

const excludePaths = [
  'src/utils/logger.ts',
  'supabase/functions/_shared/logger.ts',
  'src/hooks/use-toast.ts',
  'src/components/ui/toast.tsx',
  'src/ui/ToastService.ts'
];

let totalRemoved = 0;

function removeConsoleStatements(content: string): string {
  let modified = content;
  
  // Remove console.log/info/debug/trace calls with various formats
  modified = modified.replace(/\s*console\.(log|info|debug|trace)\([^;]*\);?\s*\n?/g, '');
  modified = modified.replace(/console\.(log|info|debug|trace)\([^)]*\);\s*/g, '');
  modified = modified.replace(/console\.(log|info|debug|trace)\(\s*[^)]*\s*\);\s*/gs, '');
  
  return modified;
}

function removeToastStatements(content: string): string {
  let modified = content;
  
  // Remove toast imports
  modified = modified.replace(/import.*\{[^}]*useToast[^}]*\}.*from.*;\s*/g, '');
  modified = modified.replace(/import.*useToast.*from.*;\s*/g, '');
  modified = modified.replace(/import.*\{[^}]*toast[^}]*\}.*from.*;\s*/g, '');
  
  // Remove useToast hook declarations
  modified = modified.replace(/const\s*\{\s*toast\s*\}\s*=\s*useToast\(\);\s*/g, '');
  
  // Remove toast calls
  modified = modified.replace(/\s*toast\(\s*\{[^}]*\}\s*\);\s*/gs, '');
  modified = modified.replace(/toast\(\s*\{[^}]*\}\s*\);\s*/gs, '');
  
  // Remove Toaster components
  modified = modified.replace(/<Toaster[^>]*\/?>.*?<\/Toaster>?/gs, '');
  modified = modified.replace(/<Toaster[^>]*\/>/g, '');
  
  return modified;
}

files.forEach(pattern => {
  const matches = glob.sync(pattern);
  matches.forEach(file => {
    if (excludePaths.some(exclude => file.endsWith(exclude))) return;
    
    try {
      let content = readFileSync(file, 'utf8');
      const originalLength = content.length;
      
      content = removeConsoleStatements(content);
      content = removeToastStatements(content);
      
      if (content.length !== originalLength) {
        writeFileSync(file, content);
        totalRemoved += originalLength - content.length;
        logger.info(`Cleaned ${file}: ${originalLength - content.length} chars removed`);
      }
    } catch (error) {
      logger.error(`Error processing ${file}:`, error);
    }
  });
});

logger.info(`✨ Batch Silence Sweep Complete: ${totalRemoved} characters of violations removed`);