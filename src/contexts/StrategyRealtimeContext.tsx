import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Shared Realtime subscription for the trading_strategies table.
 * 
 * Previously, useActiveStrategy + StrategyConfig each opened their own channel.
 * This context consolidates them into a single subscription.
 */

type StrategyChangeCallback = () => void;

interface StrategyRealtimeContextType {
  subscribe: (id: string, callback: StrategyChangeCallback) => void;
  unsubscribe: (id: string) => void;
}

const StrategyRealtimeContext = createContext<StrategyRealtimeContextType | null>(null);

export const StrategyRealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const listenersRef = useRef<Map<string, StrategyChangeCallback>>(new Map());

  const subscribe = useCallback((id: string, callback: StrategyChangeCallback) => {
    listenersRef.current.set(id, callback);
  }, []);

  const unsubscribe = useCallback((id: string) => {
    listenersRef.current.delete(id);
  }, []);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('trading_strategies_shared')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trading_strategies',
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
    <StrategyRealtimeContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </StrategyRealtimeContext.Provider>
  );
};

/**
 * Hook to subscribe to shared trading_strategies realtime changes.
 */
export const useStrategyRealtime = (id: string, callback: () => void, debounceMs = 500) => {
  const ctx = useContext(StrategyRealtimeContext);
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
