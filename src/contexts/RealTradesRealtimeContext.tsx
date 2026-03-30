import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Shared Realtime subscription for the real_trades table.
 * 
 * Previously, useRealPositions + useRealTradeHistory each opened their own channel.
 * This context consolidates them into a single subscription.
 */

type RealTradesChangeCallback = () => void;

interface RealTradesRealtimeContextType {
  subscribe: (id: string, callback: RealTradesChangeCallback) => void;
  unsubscribe: (id: string) => void;
}

const RealTradesRealtimeContext = createContext<RealTradesRealtimeContextType | null>(null);

export const RealTradesRealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const listenersRef = useRef<Map<string, RealTradesChangeCallback>>(new Map());

  const subscribe = useCallback((id: string, callback: RealTradesChangeCallback) => {
    listenersRef.current.set(id, callback);
  }, []);

  const unsubscribe = useCallback((id: string) => {
    listenersRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('real_trades_shared')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'real_trades',
          filter: `user_id=eq.${user.id}`
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
  }, [user]);

  return (
    <RealTradesRealtimeContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </RealTradesRealtimeContext.Provider>
  );
};

/**
 * Hook to subscribe to shared real_trades realtime changes.
 */
export const useRealTradesRealtime = (id: string, callback: () => void, debounceMs = 500) => {
  const ctx = useContext(RealTradesRealtimeContext);
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
