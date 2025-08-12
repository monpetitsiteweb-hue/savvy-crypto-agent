import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Trade {
  id: string
  user_id: string
  trade_type: string
  cryptocurrency: string
  amount: number
  price: number
  total_value: number
  executed_at: string
  original_purchase_value?: number
}

// Helper functions for rounding
const round2 = (n: number) => Math.round(n * 100) / 100
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const round8 = (n: number) => Math.round(n * 1e8) / 1e8

// Fee rate determination based on account type
const getFeeRate = (accountType: string) => {
  return accountType === 'COINBASE_PRO' ? 0 : 0.05 // 0% or 5%
}

// Symbol normalization for FIFO matching
function normalizeSymbol(sym: string): string {
  const s = sym.trim().toUpperCase().replace(/\s+/g, '');
  if (s.includes('-')) return s;         // already base-quote
  // Test mode is EUR-quoted; default to EUR when missing
  return `${s}-EUR`;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    // Parse request body
    const { scope = 'all_users', userId, mode = 'test', dryRun = false } = await req.json()
    
    // Initialize Supabase admin client with service role
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // service role
      { auth: { persistSession: false } }
    )

    console.log(`🔥 BACKFILL: Starting backfill process (scope: ${scope}, mode: ${mode}, dryRun: ${dryRun})`)

    // Get all users who have SELL trades missing snapshots
    let usersQuery = supabaseAdmin
      .from('mock_trades')
      .select('user_id')
      .eq('trade_type', 'sell')
      .is('original_purchase_value', null)
      .order('user_id')

    // If single user mode, filter by userId
    if (scope === 'single_user' && userId) {
      usersQuery = usersQuery.eq('user_id', userId)
    }

    const { data: usersWithMissingSells, error: usersError } = await usersQuery

    if (usersError) {
      throw usersError
    }

    // Get unique user IDs
    const uniqueUserIds = [...new Set(usersWithMissingSells?.map(t => t.user_id) || [])]
    console.log(`🔥 BACKFILL: Found ${uniqueUserIds.length} users with missing SELL snapshots`)

    let totalUpdated = 0
    let totalSkippedOrphans = 0
    const orphansSample: any[] = []
    const results: any[] = []

    // Process each user
    for (const userId of uniqueUserIds) {
      console.log(`🔥 BACKFILL: Processing user ${userId}`)

      // Get user profile for fee calculation
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .single()

      const accountType = profile?.username?.includes('coinbase') ? 'COINBASE_PRO' : 'OTHER'
      const feeRate = getFeeRate(accountType)

      // Get all trades for this user, ordered chronologically
      const { data: allTrades, error: tradesError } = await supabaseAdmin
        .from('mock_trades')
        .select('*')
        .eq('user_id', userId)
        .order('executed_at', { ascending: true })

      if (tradesError) {
        console.error(`❌ BACKFILL: Error fetching trades for user ${userId}:`, tradesError)
        continue
      }

      // Process trades per normalized cryptocurrency symbol
      const cryptoTrades: Record<string, Trade[]> = {}
      
      // Group trades by normalized cryptocurrency
      for (const trade of allTrades || []) {
        const normalizedSymbol = normalizeSymbol(trade.cryptocurrency)
        if (!cryptoTrades[normalizedSymbol]) {
          cryptoTrades[normalizedSymbol] = []
        }
        cryptoTrades[normalizedSymbol].push(trade)
      }

      // Process each cryptocurrency separately
      for (const [normalizedCrypto, trades] of Object.entries(cryptoTrades)) {
        console.log(`🔥 BACKFILL: Processing ${normalizedCrypto} trades for user ${userId}`)

        // Build FIFO lots and process SELLs
        const buyLots: Array<{
          id: string
          amount: number
          price: number
          total_value: number
          executed_at: string
          remaining: number
        }> = []

        for (const trade of trades) {
          if (trade.trade_type === 'buy') {
            // Add to buy lots
            buyLots.push({
              id: trade.id,
              amount: trade.amount,
              price: trade.price,
              total_value: trade.total_value,
              executed_at: trade.executed_at,
              remaining: trade.amount
            })
          } else if (trade.trade_type === 'sell') {
            // Check if this SELL already has snapshot data
            if (trade.original_purchase_value !== null && trade.original_purchase_value !== undefined) {
              console.log(`🔥 BACKFILL: SELL ${trade.id} already has snapshot data, skipping`)
              continue
            }

            // Allocate this SELL against buy lots using FIFO
            const allocation: Array<{
              lotId: string
              matchedAmount: number
              buyPrice: number
              buyValuePortion: number
            }> = []

            let remainingToSell = trade.amount
            
            for (const lot of buyLots) {
              if (remainingToSell <= 0) break
              if (lot.remaining <= 0) continue
              
              const allocated = Math.min(lot.remaining, remainingToSell)
              const buyValuePortion = (allocated / lot.amount) * lot.total_value
              
              allocation.push({
                lotId: lot.id,
                matchedAmount: allocated,
                buyPrice: lot.price,
                buyValuePortion: buyValuePortion
              })
              
              lot.remaining -= allocated
              remainingToSell -= allocated
            }

            // Check if we have any BUY liquidity
            if (allocation.length === 0) {
              // Orphan SELL - no matching BUY trades
              console.log(`⚠️ BACKFILL: Orphan SELL ${trade.id} - no BUY liquidity for ${normalizedCrypto}`)
              totalSkippedOrphans++
              
              if (orphansSample.length < 20) {
                orphansSample.push({
                  sell_id: trade.id,
                  symbol: trade.cryptocurrency,
                  norm: normalizedCrypto,
                  amount: round8(trade.amount)
                })
              }
              continue // Skip orphans - do not write 0 snapshots
            }

            // Calculate snapshot data
            const original_purchase_amount = allocation.reduce((sum, a) => sum + a.matchedAmount, 0)
            const original_purchase_value = round2(allocation.reduce((sum, a) => sum + a.buyValuePortion, 0))
            const original_purchase_price = original_purchase_amount > 0 
              ? round6(original_purchase_value / original_purchase_amount) 
              : 0

            // Always set exit_value = round2(amount * price) for the SELL
            const exit_value = round2(trade.amount * trade.price)
            const buy_fees = round2(original_purchase_value * feeRate)
            const sell_fees = round2(exit_value * feeRate)
            const realized_pnl = round2((exit_value - sell_fees) - (original_purchase_value + buy_fees))
            const realized_pnl_pct = original_purchase_value > 0
              ? round2((realized_pnl / original_purchase_value) * 100)
              : 0

            // Guard: only UPDATE when original_purchase_amount > 0 AND original_purchase_value > 0 AND original_purchase_price > 0
            if (original_purchase_amount <= 0 || original_purchase_value <= 0 || original_purchase_price <= 0) {
              console.log(`⚠️ BACKFILL: Invalid snapshot data for SELL ${trade.id}, skipping update`)
              totalSkippedOrphans++
              
              if (orphansSample.length < 20) {
                orphansSample.push({
                  sell_id: trade.id,
                  symbol: trade.cryptocurrency,
                  norm: normalizedCrypto,
                  amount: round8(trade.amount),
                  reason: 'invalid_snapshot_data'
                })
              }
              continue
            }

            // Update the SELL trade with snapshot data (if not dryRun)
            if (!dryRun) {
              const { error: updateError } = await supabaseAdmin
                .from('mock_trades')
                .update({
                  original_purchase_amount: round8(original_purchase_amount),
                  original_purchase_price,
                  original_purchase_value,
                  exit_value,
                  buy_fees,
                  sell_fees,
                  realized_pnl,
                  realized_pnl_pct
                })
                .eq('id', trade.id)
                .eq('trade_type', 'sell')  // Safety: only update SELLs
                .is('original_purchase_value', null)  // Safety: only update missing snapshots

              if (updateError) {
                console.error(`❌ BACKFILL: Error updating SELL ${trade.id}:`, updateError)
                continue
              }
            }

            console.log(`✅ BACKFILL: ${dryRun ? 'Would update' : 'Updated'} SELL ${trade.id} with snapshot data`)
            totalUpdated++
            
            // Store example for reporting
            if (results.length < 5) {
              results.push({
                trade_id: trade.id,
                user_id: userId,
                cryptocurrency: trade.cryptocurrency,
                normalized_symbol: normalizedCrypto,
                amount: trade.amount,
                original_purchase_amount: round8(original_purchase_amount),
                original_purchase_price,
                original_purchase_value,
                exit_value,
                realized_pnl,
                realized_pnl_pct
              })
            }
          }
        }
      }
    }

    const endTime = Date.now()
    console.log(`🔥 BACKFILL: Completed. Updated: ${totalUpdated}, Orphans: ${totalSkippedOrphans}`)

    return new Response(
      JSON.stringify({
        success: true,
        scope,
        userId: scope === 'single_user' ? userId : undefined,
        sell_total: totalUpdated + totalSkippedOrphans,
        sell_updated: totalUpdated,
        sell_skipped_orphans: totalSkippedOrphans,
        orphans_sample: orphansSample,
        started_at: new Date(startTime).toISOString(),
        ended_at: new Date(endTime).toISOString(),
        duration_ms: endTime - startTime,
        dryRun,
        sample_updated_trades: results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('❌ BACKFILL: Error during backfill process:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        details: 'Check edge function logs for more details'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})