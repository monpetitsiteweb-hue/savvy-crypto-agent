import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/utils/logger';
import { normalizeStrategy, StrategyData } from '@/types/strategy';

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
      console.debug('🔍 useActiveStrategy fetching:', { 
        testMode, 
        userIdUsedInQuery: user.id, 
        filters: { 
          user_id: user.id, 
          is_active: true,
          is_test_mode: testMode 
        } 
      });

      // For simplicity, we'll look for active strategies based on is_active flag
      // and match the test mode with is_test_mode
      const { data: strategies, error } = await (supabase as any)
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .eq('test_mode', testMode)
        .order('created_at', { ascending: false })
        .limit(1);
        
      const data = strategies?.[0] || null;

      console.debug('📊 useActiveStrategy results:', {
        testMode,
        userIdUsedInQuery: user.id,
        filters: `user_id=${user.id}, is_active=true, is_test_mode=${testMode}`,
        rowCount: strategies?.length || 0,
        foundStrategyId: data?.id || 'none'
      });

      if (error) {
        console.error('❌ useActiveStrategy error:', error);
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