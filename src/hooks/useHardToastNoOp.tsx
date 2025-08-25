import { useEffect, useRef } from 'react';

// Step 12: Hard toast no-op at the enqueue point (debug-only)
// Monkey-patches the global toast function when muteNotifs=1

interface ToastStats {
  suppressedCount: number;
  lastLogTime: number;
}

export const useHardToastNoOp = () => {
  const originalToastRef = useRef<any>(null);
  const statsRef = useRef<ToastStats>({ suppressedCount: 0, lastLogTime: 0 });
  
  useEffect(() => {
    // Check if hard muting is enabled
    const shouldMute = (() => {
      try {
        const url = new URL(window.location.href);
        return url.searchParams.get('debug') === 'history' && url.searchParams.get('muteNotifs') === '1';
      } catch {
        return false;
      }
    })();
    
    if (!shouldMute) return;
    
    // Import and monkey-patch the toast function
    const patchToast = async () => {
      try {
        const toastModule = await import('@/hooks/use-toast');
        
        // Store original if not already done
        if (!originalToastRef.current) {
          originalToastRef.current = toastModule.toast;
        }
        
        // Replace with no-op that counts suppressions
        (toastModule as any).toast = (...args: any[]) => {
          statsRef.current.suppressedCount++;
          
          // Rate-limited logging (once per second)
          const now = performance.now();
          if (now - statsRef.current.lastLogTime >= 1000) {
            const rate = statsRef.current.suppressedCount / ((now - statsRef.current.lastLogTime + 1000) / 1000);
            console.info(`[HistoryBlink] notif: muted (suppressed ${rate.toFixed(1)}/s)`);
            statsRef.current.lastLogTime = now;
            statsRef.current.suppressedCount = 0;
          }
          
          // Return mock toast object
          return { id: 'muted', dismiss: () => {}, update: () => {} };
        };
        
        console.info('[HistoryBlink] toast: hard no-op active (global patch)');
      } catch (error) {
        console.warn('[HistoryBlink] toast: failed to patch', error);
      }
    };
    
    patchToast();
    
    // Cleanup: restore original toast on unmount
    return () => {
      if (originalToastRef.current) {
        import('@/hooks/use-toast').then(toastModule => {
          (toastModule as any).toast = originalToastRef.current;
        });
      }
    };
  }, []);
};