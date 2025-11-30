// Silent logger utility to replace console spam

// Check if logs should be suppressed
const engineDebugEnabled = () => {
  if (typeof window === "undefined") return true;
  return (window as any).__INTELLIGENT_SUPPRESS_LOGS !== true;
};

export const silentLog = {
  log: (message: string, data?: any) => {
    if (!engineDebugEnabled()) return;
    // Route to silent background logging only
    (window as any).NotificationSink?.log({ message, data });
  }
};

// Global console silence helper for trading engine
// Respects window.__INTELLIGENT_SUPPRESS_LOGS = true to fully silence
export const engineLog = (message: string, ...args: any[]) => {
  // If suppressed, do nothing
  if (!engineDebugEnabled()) return;
  
  // Only show HistoryPerf logs in console, everything else goes to silent sink
  if (message.includes('[HistoryPerf]')) {
    console.log(message, ...args);
  } else {
    (window as any).NotificationSink?.log({ message: message.replace(/🚨|🔄|🔍|🧮|🐋|🤖|📊|💸|🎯|🛑/g, '').trim(), data: args });
  }
};
