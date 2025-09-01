import { useEffect } from 'react';
import { useIntelligentTradingEngine } from '@/hooks/useIntelligentTradingEngine';

// Extend window interface for debug APIs
declare global {
  interface Window {
    Engine?: {
      tick: () => Promise<void>;
      sanity: () => Promise<void>;
      debugBuy: (sym: string, eur: number) => Promise<void>;
    };
  }
}

export default function EngineBoot() {
  const { checkStrategiesAndExecute } = useIntelligentTradingEngine();

  useEffect(() => {
    // Visible boot banner (console + NotificationSink)
    console.warn('🚚 ENGINE_BOOT_MOUNTED', { ts: Date.now() });
    (window as any).NotificationSink?.log({ message: 'ENGINE_BOOT_MOUNTED', data: { ts: Date.now() } });

    // Minimal debug API to trigger/triage quickly
    window.Engine = {
      tick: async () => {
        console.warn('⏩ ENGINE_DEBUG_TICK');
        await checkStrategiesAndExecute();
      },
      sanity: async () => {
        console.warn('🩺 ENGINE_SANITY_START');
        // Very light, safe read probe (no writes)
        try {
          const { supabase } = await import('@/integrations/supabase/client');
          const { data, error } = await supabase
            .from('trading_strategies')
            .select('id')
            .limit(1);
          console.warn('🩺 ENGINE_SANITY_DB', { ok: !error, rows: data?.length ?? 0, error });
        } catch (e) {
          console.error('🩺 ENGINE_SANITY_ERR', e);
        }
      },
      debugBuy: async (sym: string, eur: number) => {
        console.warn('🧪 ENGINE_DEBUG_BUY', { sym, eur });
        const { supabase } = await import('@/integrations/supabase/client');

        // quick test insert (test mode only; base symbol)
        const base = sym.replace('-EUR', '').toUpperCase();
        const price = 10; // small sentinel value for sanity
        const qty = eur / price;

        // don't mutate balances, just try DB insert to prove pipeline
        const { data, error } = await supabase.from('mock_trades').insert({
          strategy_id: 'debug',
          user_id: (await supabase.auth.getUser()).data.user?.id,
          trade_type: 'buy',
          cryptocurrency: base,
          amount: qty,
          price,
          total_value: eur,
          fees: 0,
          strategy_trigger: 'DEBUG_INSERT',
          notes: 'sanity',
          is_test_mode: true,
          profit_loss: 0,
          executed_at: new Date().toISOString(),
        }).select();

        console.warn('🧪 ENGINE_DEBUG_BUY_RESULT', { ok: !error, id: data?.[0]?.id, error });
      }
    };
  }, [checkStrategiesAndExecute]);

  return null;
}