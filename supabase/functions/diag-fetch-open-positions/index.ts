// Diagnostic: invoke the SAME query+FIFO logic as backend-shadow-engine
// fetchOpenPositions() against (user, strategy, isTestMode=false) and return
// the exact openLots array the exit cycle would see.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DUST_THRESHOLD = 1e-8;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const userId = url.searchParams.get('userId') ?? '3a05bf2d-0a8c-4909-9e79-bed87e46270c';
  const strategyId = url.searchParams.get('strategyId') ?? '658ad973-e693-42d5-a0f7-21a1aa922679';
  const isTestMode = (url.searchParams.get('isTestMode') ?? 'false') === 'true';
  const symbolFilter = url.searchParams.get('symbol'); // e.g. "ETH"

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // EXACT same SELECT as fetchOpenPositions (L2316-2324) — no is_corrupted /
  // is_archived / is_open_position / settlement_status filters.
  const PAGE = 1000;
  let offset = 0;
  let all: any[] = [];
  while (true) {
    const { data, error } = await supa
      .from('mock_trades')
      .select('cryptocurrency, trade_type, amount, price, executed_at, id')
      .eq('user_id', userId)
      .eq('strategy_id', strategyId)
      .eq('is_test_mode', isTestMode)
      .eq('execution_confirmed', true)
      .order('executed_at', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return new Response(JSON.stringify({ error }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
    if (offset > 50000) break;
  }

  // Identical reconstruction loop as fetchOpenPositions (L2345-2424)
  const positionMap = new Map<string, any>();
  for (const t of all) {
    const sym = t.cryptocurrency.replace('-EUR', '');
    if (symbolFilter && sym !== symbolFilter) continue;
    if (!positionMap.has(sym)) positionMap.set(sym, { totalBuyAmount: 0, totalSellAmount: 0, buyTrades: [] });
    const p = positionMap.get(sym);
    if (t.trade_type === 'buy') {
      p.totalBuyAmount += Number(t.amount);
      p.buyTrades.push({ amount: Number(t.amount), price: Number(t.price), executedAt: t.executed_at, id: t.id });
    } else if (t.trade_type === 'sell') {
      p.totalSellAmount += Number(t.amount);
    }
  }

  const result: any[] = [];
  for (const [symbol, pos] of positionMap) {
    const net = pos.totalBuyAmount - pos.totalSellAmount;
    if (net <= 0.00000001) continue;
    let remainingSold = pos.totalSellAmount;
    const openLots: any[] = [];
    for (const buy of pos.buyTrades) {
      const consumed = Math.min(remainingSold, buy.amount);
      const rem = buy.amount - consumed;
      remainingSold = Math.max(0, remainingSold - buy.amount);
      if (rem > DUST_THRESHOLD) {
        openLots.push({
          id: buy.id,
          executed_at: buy.executedAt,
          entry_price: buy.price,
          remaining_amount: rem,
          original_amount: buy.amount,
        });
      }
    }
    result.push({ symbol, netAmount: net, totalBuys: pos.buyTrades.length, openLots });
  }

  return new Response(JSON.stringify({ userId, strategyId, isTestMode, positions: result }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
