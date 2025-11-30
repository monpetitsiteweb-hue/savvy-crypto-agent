import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

export const TechnicalIndicatorRefresh = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Clear React Query cache for indicators
      await queryClient.invalidateQueries({ queryKey: ['technical-indicators'] });
      
      // Trigger the technical signal generator to recalculate indicators
      const { data, error } = await supabase.functions.invoke('technical-signal-generator', {
        body: { 
          symbols: ['BTC-EUR', 'ETH-EUR', 'XRP-EUR'],
          forceRefresh: true 
        }
      });
      
      if (error) {
        // Silent error handling
      }
      
      // Force another cache invalidation after generation
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['technical-indicators'] });
      }, 2000);
      
    } catch (error) {
      console.error('Failed to refresh indicators:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Button 
      onClick={handleRefresh}
      disabled={isRefreshing}
      variant="outline"
      size="sm"
      className="flex items-center gap-2"
    >
      <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
      {isRefreshing ? 'Refreshing...' : 'Refresh Indicators'}
    </Button>
  );
};