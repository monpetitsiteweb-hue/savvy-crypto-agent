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
      
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .eq(activeField, true)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error('Error loading active strategy:', error);
      }

      setActiveStrategy(data || null);
    } catch (error) {
      console.error('Error loading active strategy:', error);
      setActiveStrategy(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActiveStrategy();
  }, [user, testMode]);

  const hasActiveStrategy = !!activeStrategy;

  return {
    activeStrategy,
    hasActiveStrategy,
    loading,
    refetchActiveStrategy: loadActiveStrategy
  };
};