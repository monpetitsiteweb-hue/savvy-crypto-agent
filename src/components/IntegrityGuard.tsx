import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { checkIntegrity, type ValuationInputs } from '@/utils/valuationService';
import { useToast } from '@/hooks/use-toast';

export const IntegrityGuard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);

  const runIntegrityChecks = async () => {
    if (!user || checking) return;
    
    setChecking(true);
    try {
      console.log('🔍 INTEGRITY: Running integrity checks...');
      
      // Get all mock trades that aren't already marked as corrupted
      const { data: trades, error } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', user.id)
        .neq('is_corrupted', true);

      if (error) throw error;
      
      let corruptedCount = 0;
      
      for (const trade of trades || []) {
        if (trade.trade_type === 'buy') {
          const inputs: ValuationInputs = {
            symbol: trade.cryptocurrency,
            amount: trade.amount,
            entry_price: trade.price,
            purchase_value: trade.total_value
          };
          
          const integrityCheck = checkIntegrity(inputs);
          
          if (!integrityCheck.is_valid) {
            console.warn(`🚨 INTEGRITY: Trade ${trade.id} failed checks:`, integrityCheck.errors);
            
            // Mark as corrupted
            await supabase
              .from('mock_trades')
              .update({
                is_corrupted: true,
                integrity_reason: integrityCheck.errors.join('; ')
              })
              .eq('id', trade.id);
            
            corruptedCount++;
          }
        }
      }
      
      if (corruptedCount > 0) {
        toast({
          title: "Data Integrity Issues Found",
          description: `${corruptedCount} trades marked as corrupted and need review.`,
          variant: "destructive",
        });
      }
      
      console.log(`✅ INTEGRITY: Check complete. Found ${corruptedCount} corrupted trades.`);
      
    } catch (error) {
      console.error('❌ INTEGRITY: Check failed:', error);
    } finally {
      setChecking(false);
    }
  };

  // Run integrity check on component mount and periodically
  useEffect(() => {
    if (user) {
      runIntegrityChecks();
      
      // Run checks every 5 minutes
      const interval = setInterval(runIntegrityChecks, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [user]);

  return null; // This is a background service component
};