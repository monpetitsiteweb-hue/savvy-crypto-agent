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
      
      // Show detailed strategy info
      if (allStrategies && Array.isArray(allStrategies) && allStrategies.length > 0) {
        console.log('📋 Strategy details:');
        allStrategies.forEach((strategy, index) => {
          console.log(`  ${index + 1}. ${strategy.strategy_name}:`);
          console.log(`     - id: ${strategy.id}`);
          console.log(`     - is_active_test: ${strategy.is_active_test}`);
          console.log(`     - is_active_live: ${strategy.is_active_live}`);
          console.log(`     - is_active: ${strategy.is_active}`);
        });
      }
      
      console.log('🔍 Now querying for active strategy with:', activeField, '= true');
      
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq(activeField, true)
        .maybeSingle(); // Use maybeSingle instead of single to avoid errors
        
      console.log('📊 Active strategy query result:', { data, error });
      console.log('📊 Active strategy data:', data);
      console.log('📊 Active strategy error:', error);

      if (error) {
        console.error('❌ Error loading active strategy:', error);
      }

      if (!data) {
        console.log('⚠️ No active strategy found for current mode:', testMode ? 'test' : 'live');
        console.log('⚠️ Looking for field:', activeField, '= true');
        if (allStrategies && Array.isArray(allStrategies) && allStrategies.length > 0) {
          console.log('⚠️ But you have these strategies available:');
          allStrategies.forEach((strategy, index) => {
            const isActiveInCurrentMode = strategy[activeField];
            console.log(`  ${index + 1}. ${strategy.strategy_name}: ${activeField} = ${isActiveInCurrentMode}`);
          });
        }
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