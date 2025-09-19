// supabase/functions/_shared/logger.ts
const DEBUG = (Deno.env.get('DEBUG') === '1'); // set only in local dev if needed

const noop = () => {};

export const logger = {
  debug: DEBUG ? console.debug.bind(console) : noop,
  info:  console.info.bind(console),  // Always log info for observability
  log:   console.log.bind(console),   // Always log
  trace: noop,
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
} as const;