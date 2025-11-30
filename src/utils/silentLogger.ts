// Silent logger utility - ALL logs suppressed by default

// Check if logs should be shown (only when explicitly enabled)
const shouldShowLogs = () => {
  if (typeof window === "undefined") return false;
  // Logs are SUPPRESSED by default, only show if explicitly set to false
  return (window as any).__INTELLIGENT_SUPPRESS_LOGS === false;
};

export const silentLog = {
  log: (_message: string, _data?: any) => {
    // Always silent
  }
};

// Global console silence helper for trading engine
// All logs suppressed by default
export const engineLog = (_message: string, ..._args: any[]) => {
  // Completely silent - no logs
};
