import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Shared Realtime subscription for the mock_trades table.
 * 
 * CHURN FIX: Uses user.id (stable string) as dependency instead of user object,
 * preventing channel recreation on every auth token refresh.
 */

type MockTradesChangeCallback = () => void;

interface MockTradesRealtimeContextType {
  subscribe: (id: string, callback: MockTradesChangeCallback) => void;
  unsubscribe: (id: string) => void;
}

const MockTradesRealtimeContext = createContext<MockTradesRealtimeContextType | null>(null);

export const MockTradesRealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const listenersRef = useRef<Map<string, MockTradesChangeCallback>>(new Map());

  const subscribe = useCallback((id: string, callback: MockTradesChangeCallback) => {
    listenersRef.current.set(id, callback);
  }, []);

  const unsubscribe = useCallback((id: string) => {
    listenersRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel('mock_trades_shared')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mock_trades',
          filter: `user_id=eq.${userId}`
        },
        () => {
          for (const callback of listenersRef.current.values()) {
            callback();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]); // Stable string dependency — no churn on token refresh

  return (
    <MockTradesRealtimeContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </MockTradesRealtimeContext.Provider>
  );
};

/**
 * Hook to subscribe to shared mock_trades realtime changes.
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
