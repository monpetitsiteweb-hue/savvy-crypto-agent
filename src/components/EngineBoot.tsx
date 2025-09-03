'use client';

import { useEffect } from 'react';
import { useIntelligentTradingEngine } from '@/hooks/useIntelligentTradingEngine';
import { supabase } from '@/integrations/supabase/client';
import { useMockWallet } from '@/hooks/useMockWallet';
import { getDebugInfo, getPrices } from '@/services/CoinbasePriceBus';

declare global {
  interface Window {
    Engine?: {
      tick: () => Promise<any>;
      sanity: () => Promise<any>;
      session: () => Promise<any>;
      user: () => Promise<any>;
      priceDataProbe: () => Promise<any>;
      priceCache: () => any;
      refreshPrices: (symbols?: string[]) => Promise<any>;
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
        console.error('[EngineAPI] sanity called');
        try {
          const { data, error } = await supabase.from('trading_strategies').select('id').limit(1);
          const result = { ok: !error, rows: data?.length ?? 0, error };
          console.error('🩺 ENGINE_SANITY_DB', result);
          return result;
        } catch (err) {
          console.error('[EngineAPI] sanity error', err);
          throw err;
        }
      },
      
      session: async () => {
        console.error('[EngineAPI] session called');
        try {
          const s = await supabase.auth.getSession();
          const out = {
            present: !!s.data.session,
            user_id: s.data.session?.user?.id ?? null,
            expires_at: s.data.session?.expires_at ?? null,
          };
          console.error('[EngineSession]', out);
          return out;
        } catch (err) {
          console.error('[EngineAPI] session error', err);
          throw err;
        }
      },

      user: async () => {
        console.error('[EngineAPI] user called');
        try {
          const u = await supabase.auth.getUser();
          const out = { user_id: u.data.user?.id ?? null };
          console.error('[EngineUser]', out);
          return out;
        } catch (err) {
          console.error('[EngineAPI] user error', err);
          throw err;
        }
      },

      tick: async () => {
        console.error('[EngineAPI] tick called');
        try {
          console.error('⏩ ENGINE_DEBUG_TICK');
          const out = await checkStrategiesAndExecute();
          console.error('[EngineAPI] tick completed', out);
          return out;
        } catch (err) {
          console.error('[EngineAPI] tick error', err);
          throw err;
        }
      },

      priceDataProbe: async () => {
        console.error('[EngineAPI] priceDataProbe called');
        try {
          const { data, error } = await supabase.from('price_data').select('symbol').limit(1);
          const out = { ok: !error, data, error };
          console.error('[PriceDataProbe]', out);
          return out;
        } catch (err) {
          console.error('[EngineAPI] priceDataProbe error', err);
          throw err;
        }
      },

      priceCache: () => {
        console.error('[EngineAPI] priceCache called');
        try {
          const info = getDebugInfo();
          console.error('[PriceCache]', info);
          return info;
        } catch (err) {
          console.error('[EngineAPI] priceCache error', err);
          throw err;
        }
      },

      refreshPrices: async (symbols?: string[]) => {
        console.error('[EngineAPI] refreshPrices called');
        try {
          console.error('[RefreshPrices] Fetching:', symbols);
          const results = await getPrices(symbols || ['BTC-EUR', 'ETH-EUR', 'XRP-EUR']);
          console.error('[RefreshPrices] Results:', results);
          return results;
        } catch (err) {
          console.error('[EngineAPI] refreshPrices error', err);
          throw err;
        }
      },
      debugBuy: async (sym: string, eur: number) => {
        console.error('[EngineAPI] debugBuy called');
        try {
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

          console.error('🧪 [DebugBuy OK]', { ok: !error, id: data?.[0]?.id, error });
        } catch (err) {
          console.error('[EngineAPI] debugBuy error', err);
          throw err;
        }
      },
      topUpEUR: (amount = 1000) => {
        console.error('[EngineAPI] topUpEUR called');
        try {
          const before = getBalance('EUR');
          updateBalance('EUR', amount);
          const after = getBalance('EUR');
          console.error('💶 TOP_UP_EUR', { before, add: amount, after });
        } catch (err) {
          console.error('[EngineAPI] topUpEUR error', err);
          throw err;
        }
      },
      panicTrade: async (sym = 'BTC') => {
        console.error('[EngineAPI] panicTrade called');
        try {
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
        } catch (err) {
          console.error('[EngineAPI] panicTrade error', err);
          throw err;
        }
      }
    };

    // Loud heartbeat every 5s so you *see* activity even if the engine no-ops
    const hb = setInterval(() => console.error('💓 ENGINE_HEARTBEAT (boot beacon)', Date.now()), 5000);

    console.error('[EngineBoot] API ready', Object.keys(window.Engine || {}));
    
    // Kick it once after mount
    setTimeout(() => {
      console.error('[EngineBoot] first tick scheduled');
      window.Engine?.tick?.();
    }, 500);

    return () => {
      clearInterval(hb);
      banner.remove();
    };
  }, [checkStrategiesAndExecute, getBalance, updateBalance]);

  return null;
}