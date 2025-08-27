// Silent notification sink - replaces UI toasts with background logging

interface NotificationEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'success';
  code: string;
  message: string;
  meta?: any;
}

class NotificationSinkManager {
  private buffer: NotificationEntry[] = [];
  private maxEntries = 500;
  private batchTimer: NodeJS.Timeout | null = null;
  private pendingBatch: NotificationEntry[] = [];
  private enabled = false;

  init() {
    this.enabled = true;
    console.log('[HistoryPerf] NotificationSink initialized');
  }

  append(entry: Omit<NotificationEntry, 'ts'>) {
    if (!this.enabled) return;

    const fullEntry: NotificationEntry = {
      ...entry,
      ts: Date.now()
    };

    // Add to ring buffer
    this.buffer.push(fullEntry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }

    // Log to console immediately
    const logFn = this.getLogFunction(entry.level);
    logFn(`[NotificationSink] ${entry.code}: ${entry.message}`, entry.meta || '');

    // Add to pending batch for optional Supabase insert
    this.pendingBatch.push(fullEntry);
    this.scheduleBatchInsert();
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

  private scheduleBatchInsert() {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.flushBatch();
      this.batchTimer = null;
    }, 5000); // Batch every 5 seconds
  }

  private async flushBatch() {
    if (this.pendingBatch.length === 0) return;

    const batch = [...this.pendingBatch];
    this.pendingBatch = [];

    try {
      // Optional: Insert to Supabase table (non-blocking)
      // For now just log the batch summary
      console.log(`[NotificationSink] Batched ${batch.length} notifications`);
      
      // Future: uncomment to enable Supabase logging
      // await supabase.from('notification_logs').insert(batch);
    } catch (error) {
      console.warn('[NotificationSink] Batch insert failed:', error);
      // Put failed entries back (up to buffer limit)
      this.pendingBatch.unshift(...batch.slice(0, this.maxEntries - this.pendingBatch.length));
    }
  }

  getRecentEntries(count: number = 50): NotificationEntry[] {
    return this.buffer.slice(-count);
  }

  clear() {
    this.buffer = [];
    this.pendingBatch = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }
}

// Singleton instance
const notificationSink = new NotificationSinkManager();

// Public API
export function initNotificationSink(): void {
  notificationSink.init();
}

export function appendNotification(entry: Omit<NotificationEntry, 'ts'>): void {
  notificationSink.append(entry);
}

export function getRecentNotifications(count?: number): NotificationEntry[] {
  return notificationSink.getRecentEntries(count);
}

export function clearNotifications(): void {
  notificationSink.clear();
}

// Convenience methods to replace toast calls
export const NotificationSink = {
  success: (code: string, message: string, meta?: any) => 
    appendNotification({ level: 'success', code, message, meta }),
  
  error: (code: string, message: string, meta?: any) => 
    appendNotification({ level: 'error', code, message, meta }),
  
  warn: (code: string, message: string, meta?: any) => 
    appendNotification({ level: 'warn', code, message, meta }),
  
  info: (code: string, message: string, meta?: any) => 
    appendNotification({ level: 'info', code, message, meta }),
};