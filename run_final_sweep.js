const fs = require('fs');
const { glob } = require('glob');

// Quick batch removal of all violations
const files = glob.sync('src/**/*.{ts,tsx}').concat(glob.sync('supabase/functions/**/*.{ts,tsx}'));
const excludes = ['src/utils/logger.ts', 'supabase/functions/_shared/logger.ts'];

let totalRemoved = 0;
let filesProcessed = 0;

files.forEach(file => {
  if (excludes.some(ex => file.endsWith(ex))) return;
  
  let content = fs.readFileSync(file, 'utf8');
  const original = content.length;
  
  // Remove all console noise
  content = content.replace(/console\.(log|info|debug|trace)\([^)]*\);\s*/g, '');
  content = content.replace(/^\s*console\.(log|info|debug|trace)\(.*$/gm, '');
  
  // Remove all toast violations
  content = content.replace(/import.*useToast.*from.*;\s*/g, '');
  content = content.replace(/const\s*{\s*toast\s*}\s*=\s*useToast\(\);\s*/g, '');
  content = content.replace(/toast\(\s*{[^}]*}\s*\);\s*/g, '');
  content = content.replace(/<Toaster[^>]*\/?>/g, '');
  
  if (content.length !== original) {
    fs.writeFileSync(file, content);
    totalRemoved += original - content.length;
    filesProcessed++;
  }
});

console.log(`✅ SILENCE SWEEP COMPLETE: ${filesProcessed} files cleaned, ${totalRemoved} chars removed`);