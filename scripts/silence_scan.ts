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
  console.log('🔍 Scanning for forbidden patterns...');
  
  const files: string[] = [];
  for (const pattern of ROOTS) {
    const matches = await glob(pattern);
    files.push(...matches);
  }
  
  // Filter out excluded paths
  const filteredFiles = files.filter(f => 
    !EXCLUDE_PATHS.some(exclude => f.endsWith(exclude))
  );
  
  console.log(`📂 Scanning ${filteredFiles.length} files...`);
  
  let totalCounts: OffenderCount = {
    consoleLog: 0, consoleInfo: 0, consoleDebug: 0, consoleTrace: 0,
    toast: 0, useToast: 0, toaster: 0, showToast: 0
  };
  
  const offenderFiles: string[] = [];
  
  for (const file of filteredFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const counts = countOffenders(content);
    totalCounts = addCounts(totalCounts, counts);
    
    const hasOffenders = Object.values(counts).some(count => count > 0);
    if (hasOffenders) {
      offenderFiles.push(file);
    }
  }
  
  console.log('\n📊 FORBIDDEN PATTERN COUNTS:');
  console.log('=============================');
  console.log(`console.log:   ${totalCounts.consoleLog}`);
  console.log(`console.info:  ${totalCounts.consoleInfo}`);
  console.log(`console.debug: ${totalCounts.consoleDebug}`);
  console.log(`console.trace: ${totalCounts.consoleTrace}`);
  console.log(`toast():       ${totalCounts.toast}`);
  console.log(`useToast():    ${totalCounts.useToast}`);
  console.log(`<Toaster>:     ${totalCounts.toaster}`);
  console.log(`showToast():   ${totalCounts.showToast}`);
  
  const totalViolations = Object.values(totalCounts).reduce((sum, count) => sum + count, 0);
  
  if (totalViolations > 0) {
    console.log(`\n❌ SCAN FAILED: ${totalViolations} violations found in ${offenderFiles.length} files`);
    console.log('\nOffending files:');
    offenderFiles.forEach(file => console.log(`  - ${file}`));
    process.exit(1);
  } else {
    console.log('\n✅ SCAN PASSED: No forbidden patterns found');
    process.exit(0);
  }
}

main().catch(console.error);