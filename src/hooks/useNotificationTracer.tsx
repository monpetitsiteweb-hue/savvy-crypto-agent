import { useRef, useMemo } from 'react';
import { toast as originalToast } from '@/hooks/use-toast';

// Step 11: Notification tracer and mute toggles (prod-safe, default OFF)

// Debug toggles (only active with ?debug=history)
const getDebugToggles = () => {
  try {
    const url = new URL(window.location.href);
    const isDebugHistory = url.searchParams.get('debug') === 'history';
    
    return {
      traceNotifs: isDebugHistory && url.searchParams.get('traceNotifs') === '1',
      muteNotifs: isDebugHistory && url.searchParams.get('muteNotifs') === '1',
      muteNotifAnim: isDebugHistory && url.searchParams.get('muteNotifAnim') === '1'
    };
  } catch {
    return { traceNotifs: false, muteNotifs: false, muteNotifAnim: false };
  }
};

interface NotificationCall {
  type: string;
  source: string;
  count: number;
  lastCall: number;
}

// Global tracer state
const notificationTracker = new Map<string, NotificationCall>();
let lastLogTime = 0;
let muteLoggedOnce = false;

// Extract notification type and source from toast props
const categorizeNotification = (props: any): { type: string; source: string } => {
  const title = props.title || '';
  const description = props.description || '';
  const variant = props.variant || 'default';
  
  // Categorize by content patterns
  let type = variant;
  let source = 'unknown';
  
  if (title.includes('Trade') || description.includes('trade')) {
    type = 'trade';
    source = 'trade-event';
  } else if (title.includes('Error') || variant === 'destructive') {
    type = 'error';
    source = 'order-error';
  } else if (title.includes('Order') || description.includes('order')) {
    type = 'order';
    source = 'order-error';
  } else if (title.includes('Connection') || title.includes('Auth')) {
    type = 'connection';
    source = 'auth-status';
  } else if (title.includes('Strategy') || description.includes('strategy')) {
    type = 'strategy';
    source = 'strategy-update';
  } else if (title.includes('Market') || description.includes('price')) {
    type = 'market';
    source = 'status-poll';
  }
  
  return { type, source };
};

// Rate-limited logging (once per second)
const logNotificationStats = () => {
  const now = performance.now();
  if (now - lastLogTime < 1000) return;
  
  notificationTracker.forEach((call, key) => {
    const rate = call.count / ((now - call.lastCall + 1000) / 1000);
    console.info(`[HistoryBlink] notif: ${call.type} source=${call.source} rate=${rate.toFixed(2)}/sec`);
  });
  
  lastLogTime = now;
};

// Check if we're in History route/tab
const isHistoryRoute = () => {
  try {
    const currentTab = (() => {
      // Check URL params for active tab
      const url = new URL(window.location.href);
      return url.searchParams.get('tab') || 'dashboard';
    })();
    
    return currentTab === 'history';
  } catch {
    return false;
  }
};

export const useNotificationTracer = () => {
  const toggles = useMemo(getDebugToggles, []);
  const animSuppressedRef = useRef(false);
  
  // Log animation suppression once
  if (toggles.muteNotifAnim && isHistoryRoute() && !animSuppressedRef.current) {
    console.info('[HistoryBlink] notif: animations suppressed for History (debug)');
    animSuppressedRef.current = true;
  }
  
  // Wrapped toast function
  const toast = (props: any) => {
    const { type, source } = categorizeNotification(props);
    const now = performance.now();
    const inHistoryRoute = isHistoryRoute();
    
    // Tracing (when enabled)
    if (toggles.traceNotifs) {
      const key = `${type}-${source}`;
      const existing = notificationTracker.get(key);
      
      if (existing) {
        existing.count++;
        existing.lastCall = now;
      } else {
        notificationTracker.set(key, { type, source, count: 1, lastCall: now });
      }
      
      logNotificationStats();
    }
    
    // Muting (when in History route and enabled)
    if (toggles.muteNotifs && inHistoryRoute) {
      if (!muteLoggedOnce) {
        console.info('[HistoryBlink] notif: muted for History (debug)');
        muteLoggedOnce = true;
      }
      return { id: 'muted', dismiss: () => {}, update: () => {} };
    }
    
    // Animation suppression (modify props)
    if (toggles.muteNotifAnim && inHistoryRoute) {
      return originalToast({
        ...props,
        duration: 0, // No auto-dismiss
        className: `${props.className || ''} no-animation` // CSS class for no animations
      });
    }
    
    // Normal toast
    return originalToast(props);
  };
  
  return { toast };
};