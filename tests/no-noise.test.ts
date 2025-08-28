import fs from 'fs';
import path from 'path';

const ROOTS = ['src', 'supabase/functions'];
const ALLOWLIST = [
  'src/utils/logger.ts',
  'supabase/functions/_shared/logger.ts'
];

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) return listFiles(p);
    return p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : [];
  });
}

test('no console spam or toasts remain', () => {
  const patterns = [
    /console\.(log|info|debug|trace)\(/,
    /\btoast\(/,
    /<Toaster\b/,
    /\buseToast\(/,
    /\bshowToast\(/,
  ];

  const files = ROOTS.flatMap(listFiles).filter(p => !ALLOWLIST.some(a => p.endsWith(a)));
  const offenders: string[] = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (patterns.some(rx => rx.test(text))) offenders.push(file);
  }

  expect(offenders).toEqual([]);
});