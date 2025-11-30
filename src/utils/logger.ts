// src/utils/logger.ts
const DEV_DEBUG = import.meta.env.DEV && (import.meta.env.VITE_DEBUG === '1');

type LogFn = (...args: unknown[]) => void;

const noop: LogFn = () => {};

export const logger = {
  debug: DEV_DEBUG ? console.debug.bind(console) : noop,
  info:  console.info.bind(console),  // enabled in production for now
  log:   console.log.bind(console),   // enabled in production for now
  trace: noop, // never allowed
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
};
Object.freeze(logger);