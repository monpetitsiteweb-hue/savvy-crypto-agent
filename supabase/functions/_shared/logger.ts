// supabase/functions/_shared/logger.ts
const DEBUG = (Deno.env.get('DEBUG') === '1'); // set only in local dev if needed

const noop = () => {};

export const logger = {
  debug: DEBUG ? console.debug.bind(console) : noop,
  info:  DEBUG ? console.info.bind(console)  : noop,
  log:   noop,
  trace: noop,
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
} as const;