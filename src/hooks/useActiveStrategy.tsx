import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTradeViewFilter';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { normalizeStrategy, StrategyData } from '@/types/strategy';

/**
 * useActiveStrategy — polls trading_strategies every 30s instead of Realtime.
 * 
 * Rationale: trading_strategies has only ~1.5K total writes since stats reset.
 * Realtime subscription was causing reconnect churn on every auth token refresh.
 * Polling every 30s is more than sufficient for this low-frequency table.
 */
export const useActiveStrategy = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const [activeStrategy, setActiveStrategy] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadActiveStrategy = useCallback(async () => {
    if (!user) {
      setActiveStrategy(null);
      setLoading(false);
      return;
    }

    try {
      const { data: strategies, error } = await (supabase as any)
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .eq('test_mode', testMode)
        .order('created_at', { ascending: false })
        .limit(1);
        
      const data = strategies?.[0] || null;

      if (error) {
        logger.error('Error loading active strategy:', error);
      }

      setActiveStrategy(data ? normalizeStrategy(data) : null);
    } catch (error) {
      logger.error('Error loading active strategy:', error);
      setActiveStrategy(null);
    } finally {
      setLoading(false);
    }
  }, [user?.id, testMode]);

  // Initial load + reload on user/testMode change
  useEffect(() => {
    loadActiveStrategy();
  }, [loadActiveStrategy]);

  // Poll every 30s instead of Realtime subscription
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      loadActiveStrategy();
    }, 30_000);

    return () => clearInterval(interval);
  }, [user?.id, loadActiveStrategy]);

  const hasActiveStrategy = !!activeStrategy;

  return {
    activeStrategy,
    hasActiveStrategy,
    loading,
    refetchActiveStrategy: loadActiveStrategy
  };
};
