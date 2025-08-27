// Silent notification sink - replaces UI toasts with background logging

interface NotificationEvent {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'success';
  code?: string;
  message: string;
  meta?: any;
}

class NotificationSinkManager {
  private buffer: NotificationEvent[] = [];
  private maxEntries = 500;

  logEvent(event: Omit<NotificationEvent, 'ts'>) {
    const fullEvent: NotificationEvent = {
      ...event,
      ts: Date.now()
    };

    // Add to ring buffer
    this.buffer.push(fullEvent);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }

    // Silent console log only
    const logFn = this.getLogFunction(event.level);
    logFn(`[NotificationSink] ${event.code || 'EVENT'}: ${event.message}`, event.meta || '');
  }

  private getLogFunction(level: string) {
    switch (level) {
      case 'error': return console.error;
      case 'warn': return console.warn;
      case 'info': return console.info;
      case 'success': return console.log;
      default: return console.log;
    }
  }

  getEvents(): NotificationEvent[] {
    return [...this.buffer];
  }

  clear() {
    this.buffer = [];
  }
}

// Singleton instance
const notificationSink = new NotificationSinkManager();

// Public API
export function logEvent(event: Omit<NotificationEvent, 'ts'>): void {
  notificationSink.logEvent(event);
}

export function getEvents(): NotificationEvent[] {
  return notificationSink.getEvents();
}

export function clearEvents(): void {
  notificationSink.clear();
}