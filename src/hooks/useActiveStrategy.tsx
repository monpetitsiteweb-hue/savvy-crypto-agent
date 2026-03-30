import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTradeViewFilter';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { normalizeStrategy, StrategyData } from '@/types/strategy';
import { useStrategyRealtime } from '@/contexts/StrategyRealtimeContext';

export const useActiveStrategy = () => {
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const [activeStrategy, setActiveStrategy] = useState<StrategyData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadActiveStrategy = async () => {
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
  };

  useEffect(() => {
    loadActiveStrategy();
  }, [user, testMode]);

  // Use shared realtime subscription instead of per-component channel
  useStrategyRealtime('useActiveStrategy', () => {
    loadActiveStrategy();
  });

  const hasActiveStrategy = !!activeStrategy;

  return {
    activeStrategy,
    hasActiveStrategy,
    loading,
    refetchActiveStrategy: loadActiveStrategy
  };
};
