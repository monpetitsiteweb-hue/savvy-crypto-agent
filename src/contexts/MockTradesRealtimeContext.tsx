import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/components/AuthProvider';

/**
 * Shared Realtime subscription for the mock_trades table.
 * 
 * Previously, 3 separate components each opened their own Realtime channel
 * to mock_trades, causing 3x fanout amplification on every WAL event.
 * This context consolidates them into a single subscription.
 */

type MockTradesChangeCallback = () => void;

interface MockTradesRealtimeContextType {
  /** Register a callback that fires on any mock_trades change for the current user */
  subscribe: (id: string, callback: MockTradesChangeCallback) => void;
  /** Unregister a callback */
  unsubscribe: (id: string) => void;
}

const MockTradesRealtimeContext = createContext<MockTradesRealtimeContextType | null>(null);

export const MockTradesRealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const listenersRef = useRef<Map<string, MockTradesChangeCallback>>(new Map());

  const subscribe = useCallback((id: string, callback: MockTradesChangeCallback) => {
    listenersRef.current.set(id, callback);
  }, []);

  const unsubscribe = useCallback((id: string) => {
    listenersRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('mock_trades_shared')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mock_trades',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          // Notify all registered listeners
          for (const callback of listenersRef.current.values()) {
            callback();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return (
    <MockTradesRealtimeContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </MockTradesRealtimeContext.Provider>
  );
};

/**
 * Hook to subscribe to shared mock_trades realtime changes.
 * @param id - Unique identifier for this subscriber (e.g. component name)
 * @param callback - Function to call when mock_trades changes
 * @param debounceMs - Optional debounce delay (default 500ms)
 */
export const useMockTradesRealtime = (id: string, callback: () => void, debounceMs = 500) => {
  const ctx = useContext(MockTradesRealtimeContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!ctx) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const debouncedCallback = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => callbackRef.current(), debounceMs);
    };

    ctx.subscribe(id, debouncedCallback);

    return () => {
      if (timer) clearTimeout(timer);
      ctx.unsubscribe(id);
    };
  }, [ctx, id, debounceMs]);
};
