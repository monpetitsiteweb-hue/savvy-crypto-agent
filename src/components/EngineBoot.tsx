'use client';

import { useEffect } from 'react';
import { useIntelligentTradingEngine } from '@/hooks/useIntelligentTradingEngine';
import { supabase } from '@/integrations/supabase/client';
import { useMockWallet } from '@/hooks/useMockWallet';

declare global {
  interface Window {
    Engine?: {
      tick: () => Promise<void>;
      sanity: () => Promise<void>;
      debugBuy: (sym: string, eur: number) => Promise<void>;
      topUpEUR: (amount?: number) => void;
      panicTrade: (sym?: string) => Promise<void>;
    };
  }
}

export default function EngineBoot() {
  console.info('[EngineCanary] mounted', Date.now());
  
  const { checkStrategiesAndExecute } = useIntelligentTradingEngine();
  const { updateBalance, getBalance } = useMockWallet();

  useEffect(() => {
    // Unmissable banner in the DOM (so we know the component mounted)
    const banner = document.createElement('div');
    banner.id = 'engine-boot-banner';
    banner.style.cssText = `
      position:fixed;left:8px;bottom:8px;z-index:999999;
      background:#111;color:#0f0;padding:6px 10px;border-radius:8px;
      font:12px/1.2 monospace;opacity:.9
    `;
    banner.textContent = `ENGINE BOOTED @ ${new Date().toLocaleTimeString()}`;
    document.body.appendChild(banner);

    console.error('🚚 ENGINE_BOOT_MOUNTED (client)', { ts: Date.now() }); // error-level = always visible

    // Debug API (can't rely on logs alone)
    window.Engine = {
      sanity: async () => {
        console.info('[EngineCanary] sanity', Date.now());
        const { data, error } = await supabase.from('trading_strategies').select('id').limit(1);
        console.error('🩺 ENGINE_SANITY_DB', { ok: !error, rows: data?.length ?? 0, error });
      },
      tick: async () => {
        console.error('⏩ ENGINE_DEBUG_TICK');
        await checkStrategiesAndExecute();
      },
      debugBuy: async (sym: string, eur: number) => {
        console.error('🧪 ENGINE_DEBUG_BUY', { sym, eur });
        const uid = (await supabase.auth.getUser()).data.user?.id;
        if (!uid) return console.error('🧪 DEBUG_BUY_NO_USER');

        // grab an existing strategy for this user (active test preferred)
        const { data: strategies, error: sErr } = await supabase
          .from('trading_strategies')
          .select('id,is_active_test')
          .eq('user_id', uid)
          .order('is_active_test', { ascending: false })
          .limit(1);

        if (sErr || !strategies?.[0]?.id) {
          return console.error('🧪 DEBUG_BUY_NO_STRATEGY', { sErr, strategies });
        }

        const strategyId = strategies[0].id;

        const base = sym.replace('-EUR', '').toUpperCase();
        const price = 10; // sentinel
        const qty = eur / price;

        const { data, error } = await supabase.from('mock_trades').insert({
          strategy_id: strategyId,
          user_id: uid,
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

        console.error('🧪 ENGINE_DEBUG_BUY_RESULT', { ok: !error, id: data?.[0]?.id, error });
      },
      topUpEUR: (amount = 1000) => {
        const before = getBalance('EUR');
        updateBalance('EUR', amount);
        const after = getBalance('EUR');
        console.error('💶 TOP_UP_EUR', { before, add: amount, after });
      },
      panicTrade: async (sym = 'BTC') => {
        // absolute worst-case write probe (1 EUR @ 1 EUR)
        const uid = (await supabase.auth.getUser()).data.user?.id;
        if (!uid) return console.error('🆘 PANIC_NO_USER');

        // use same strategy lookup as debugBuy
        const { data: strategies, error: sErr } = await supabase
          .from('trading_strategies')
          .select('id')
          .eq('user_id', uid)
          .limit(1);

        const strategyId = strategies?.[0]?.id || 'panic-fallback';

        const { data, error } = await supabase.from('mock_trades').insert({
          strategy_id: strategyId,
          user_id: uid,
          trade_type: 'buy',
          cryptocurrency: sym.toUpperCase(),
          amount: 1,
          price: 1,
          total_value: 1,
          fees: 0,
          strategy_trigger: 'PANIC_WRITE',
          notes: 'panic probe',
          is_test_mode: true,
          profit_loss: 0,
          executed_at: new Date().toISOString(),
        }).select();
        console.error('🆘 PANIC_TRADE_RESULT', { ok: !error, id: data?.[0]?.id, error, strategyId });
      }
    };

    // Loud heartbeat every 5s so you *see* activity even if the engine no-ops
    const hb = setInterval(() => console.error('💓 ENGINE_HEARTBEAT (boot beacon)', Date.now()), 5000);

    // Kick it once after mount
    setTimeout(() => window.Engine?.tick?.(), 500);

    return () => {
      clearInterval(hb);
      banner.remove();
    };
  }, [checkStrategiesAndExecute, getBalance, updateBalance]);

  return null;
}