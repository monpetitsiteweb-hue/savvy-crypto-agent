#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

interface OffenderCount {
  consoleLog: number;
  consoleInfo: number;
  consoleDebug: number;
  consoleTrace: number;
  toast: number;
  useToast: number;
  toaster: number;
  showToast: number;
}

const PATTERNS = {
  consoleLog: /console\.log\(/g,
  consoleInfo: /console\.info\(/g,
  consoleDebug: /console\.debug\(/g,
  consoleTrace: /console\.trace\(/g,
  toast: /\btoast\(/g,
  useToast: /\buseToast\(/g,
  toaster: /<Toaster\b/g,
  showToast: /\bshowToast\(/g,
};

const ROOTS = ['src/**/*.{ts,tsx}', 'supabase/functions/**/*.{ts,tsx}'];
const EXCLUDE_PATHS = [
  'src/utils/logger.ts',
  'supabase/functions/_shared/logger.ts',
  'src/components/ui/use-toast.ts',
  'src/components/ui/toaster.tsx',
  'src/components/ui/toast.tsx',
  'src/ui/ToastService.ts'
];

function countOffenders(content: string): OffenderCount {
  const counts: OffenderCount = {
    consoleLog: 0,
    consoleInfo: 0,
    consoleDebug: 0,
    consoleTrace: 0,
    toast: 0,
    useToast: 0,
    toaster: 0,
    showToast: 0,
  };

  for (const [key, pattern] of Object.entries(PATTERNS)) {
    const matches = content.match(pattern);
    counts[key as keyof OffenderCount] = matches ? matches.length : 0;
  }

  return counts;
}

function sweepConsole(content: string): string {
  // Remove console.log/info/debug/trace calls entirely
  content = content.replace(/console\.(log|info|debug|trace)\([^)]*\);?\s*/g, '');
  
  // Handle multiline console calls
  content = content.replace(/console\.(log|info|debug|trace)\(\s*[^)]*\s*\);?\s*/gs, '');
  
  return content;
}

function sweepToasts(content: string, filePath: string): string {
  // Remove toast imports
  content = content.replace(/import.*useToast.*from.*;\s*/g, '');
  content = content.replace(/import.*toast.*from.*;\s*/g, '');
  
  // Remove useToast hooks
  content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
  
  // Remove toast calls
  content = content.replace(/\btoast\(\s*{[^}]*}\s*\);\s*/gs, '');
  
  // Remove Toaster components
  content = content.replace(/<Toaster[^>]*\/?>.*?<\/Toaster>?/gs, '');
  content = content.replace(/<Toaster[^>]*\/>/g, '');
  
  // Clean up any remaining toast-related variables/hooks
  content = content.replace(/const\s+{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
  
  return content;
}

async function processFile(filePath: string): Promise<{ before: OffenderCount; after: OffenderCount }> {
  const content = fs.readFileSync(filePath, 'utf8');
  const before = countOffenders(content);
  
  let newContent = content;
  newContent = sweepConsole(newContent);
  newContent = sweepToasts(newContent, filePath);
  
  const after = countOffenders(newContent);
  
  if (newContent !== content) {
    fs.writeFileSync(filePath, newContent, 'utf8');
  }
  
  return { before, after };
}

function addCounts(a: OffenderCount, b: OffenderCount): OffenderCount {
  return {
    consoleLog: a.consoleLog + b.consoleLog,
    consoleInfo: a.consoleInfo + b.consoleInfo,
    consoleDebug: a.consoleDebug + b.consoleDebug,
    consoleTrace: a.consoleTrace + b.consoleTrace,
    toast: a.toast + b.toast,
    useToast: a.useToast + b.useToast,
    toaster: a.toaster + b.toaster,
    showToast: a.showToast + b.showToast,
  };
}

async function main() {
  console.log('🧹 Starting silence sweep...');
  
  const files: string[] = [];
  for (const pattern of ROOTS) {
    const matches = await glob(pattern);
    files.push(...matches);
  }
  
  // Filter out excluded paths
  const filteredFiles = files.filter(f => 
    !EXCLUDE_PATHS.some(exclude => f.endsWith(exclude))
  );
  
  console.log(`📂 Processing ${filteredFiles.length} files...`);
  
  let totalBefore: OffenderCount = {
    consoleLog: 0, consoleInfo: 0, consoleDebug: 0, consoleTrace: 0,
    toast: 0, useToast: 0, toaster: 0, showToast: 0
  };
  
  let totalAfter: OffenderCount = {
    consoleLog: 0, consoleInfo: 0, consoleDebug: 0, consoleTrace: 0,
    toast: 0, useToast: 0, toaster: 0, showToast: 0
  };
  
  for (const file of filteredFiles) {
    const result = await processFile(file);
    totalBefore = addCounts(totalBefore, result.before);
    totalAfter = addCounts(totalAfter, result.after);
  }
  
  console.log('\n📊 SILENCE SWEEP RESULTS:');
  console.log('==========================');
  console.log(`console.log:   ${totalBefore.consoleLog} → ${totalAfter.consoleLog}`);
  console.log(`console.info:  ${totalBefore.consoleInfo} → ${totalAfter.consoleInfo}`);
  console.log(`console.debug: ${totalBefore.consoleDebug} → ${totalAfter.consoleDebug}`);
  console.log(`console.trace: ${totalBefore.consoleTrace} → ${totalAfter.consoleTrace}`);
  console.log(`toast():       ${totalBefore.toast} → ${totalAfter.toast}`);
  console.log(`useToast():    ${totalBefore.useToast} → ${totalAfter.useToast}`);
  console.log(`<Toaster>:     ${totalBefore.toaster} → ${totalAfter.toaster}`);
  console.log(`showToast():   ${totalBefore.showToast} → ${totalAfter.showToast}`);
  
  const totalReduced = (
    (totalBefore.consoleLog - totalAfter.consoleLog) +
    (totalBefore.consoleInfo - totalAfter.consoleInfo) +
    (totalBefore.consoleDebug - totalAfter.consoleDebug) +
    (totalBefore.consoleTrace - totalAfter.consoleTrace) +
    (totalBefore.toast - totalAfter.toast) +
    (totalBefore.useToast - totalAfter.useToast) +
    (totalBefore.toaster - totalAfter.toaster) +
    (totalBefore.showToast - totalAfter.showToast)
  );
  
  console.log(`\n✨ Total violations removed: ${totalReduced}`);
  console.log('🔇 Silence sweep completed!');
}

main().catch(console.error);