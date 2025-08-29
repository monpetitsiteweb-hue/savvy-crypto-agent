import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';

interface StrategyData {
  id: string;
  strategy_name: string;
  configuration: any;
  is_active: boolean;
  created_at: string;
  test_mode: boolean;
}

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
      // Query based on the current mode - look for strategies active in test or live mode
      const activeField = testMode ? 'is_active_test' : 'is_active_live';
      
      const { data: strategies, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq(activeField, true)
        .order('created_at', { ascending: false })
        .limit(1);
        
      const data = strategies?.[0] || null;

      if (error) {
        logger.error('Error loading active strategy:', error);
      }

      setActiveStrategy(data || null);
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

  // Set up real-time subscription for strategy updates
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('strategy-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trading_strategies',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          // Reload the active strategy when any strategy for this user is updated
          loadActiveStrategy();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const hasActiveStrategy = !!activeStrategy;

  return {
    activeStrategy,
    hasActiveStrategy,
    loading,
    refetchActiveStrategy: loadActiveStrategy
  };
};