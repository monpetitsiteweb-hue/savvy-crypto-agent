// Silent logger utility to replace console spam
export const silentLog = {
  log: (message: string, data?: any) => {
    // Route to silent background logging only
    (window as any).NotificationSink?.log({ message, data });
  }
};

// Global console silence helper for trading engine
export const engineLog = (message: string, ...args: any[]) => {
  // Only show HistoryPerf logs in console, everything else goes to silent sink
  if (message.includes('[HistoryPerf]')) {
    console.log(message, ...args);
  } else {
    (window as any).NotificationSink?.log({ message: message.replace(/🚨|🔄|🔍|🧮|🐋|🤖|📊|💸|🎯|🛑/g, '').trim(), data: args });
  }
};