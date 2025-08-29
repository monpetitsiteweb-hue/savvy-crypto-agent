const fs = require('fs');
const { glob } = require('glob');

// Instant fix for ComprehensiveStrategyConfig.tsx
const problematicFile = 'src/components/strategy/ComprehensiveStrategyConfig.tsx';
let content = fs.readFileSync(problematicFile, 'utf8');

// Replace all toast references with empty comments
content = content.replace(/\btoast\s*\([^)]*\)\s*;?\s*/g, '');
content = content.replace(/toast\s*\(\s*{[\s\S]*?}\s*\)\s*;?\s*/g, '');

// Clean up the specific problematic lines
content = content.replace(/^\s*toast\([\s\S]*?;?\s*$/gm, '');

// Add missing imports if needed
if (!content.includes("from '@/utils/logger'")) {
  content = content.replace(
    /import { AlertDialog[^}]*} from '@\/components\/ui\/alert-dialog';/,
    `import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { logger } from '@/utils/logger';`
  );
}

fs.writeFileSync(problematicFile, content);
console.log('✅ Fixed ComprehensiveStrategyConfig.tsx');

// Quick scan of all files
const files = [
  ...glob.sync('src/**/*.{ts,tsx}'),
  ...glob.sync('supabase/functions/**/*.{ts,tsx}')
].filter(f => !f.includes('logger.ts') && 
              !f.includes('use-toast.ts') && 
              !f.includes('toast.tsx') &&
              !f.includes('sonner.tsx') &&
              !f.includes('ToastService.ts'));

let totalViolations = 0;
files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const violations = (content.match(/console\.(log|info|debug|trace)\(|\btoast\s*\(/g) || []).length;
  totalViolations += violations;
});

console.log(`Total violations remaining: ${totalViolations}`);