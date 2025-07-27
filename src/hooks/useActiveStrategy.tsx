import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { supabase } from '@/integrations/supabase/client';

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
      
      console.log('🔍 Loading active strategy for mode:', testMode ? 'test' : 'live', 'field:', activeField);
      console.log('🔍 User ID:', user.id);
      
      // First, let's see ALL strategies for this user
      const { data: allStrategies, error: allError } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id);
        
      console.log('📋 ALL user strategies:', allStrategies);
      console.log('📋 All strategies error:', allError);
      
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq(activeField, true)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error('❌ Error loading active strategy:', error);
      }

      if (error && error.code === 'PGRST116') {
        console.log('⚠️ No active strategy found for current mode:', testMode ? 'test' : 'live');
        console.log('⚠️ Looking for field:', activeField, '= true');
        console.log('⚠️ Available strategies:', allStrategies?.map(s => ({
          id: s.id,
          name: s.strategy_name,
          is_active_test: s.is_active_test,
          is_active_live: s.is_active_live,
          is_active: s.is_active
        })));
      } else {
        console.log('✅ Found active strategy:', data);
      }

      setActiveStrategy(data || null);
    } catch (error) {
      console.error('❌ Error loading active strategy:', error);
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
        (payload) => {
          console.log('Strategy updated via real-time:', payload);
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