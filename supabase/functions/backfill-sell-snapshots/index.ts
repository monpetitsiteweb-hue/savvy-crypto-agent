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

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    // Parse request body
    const { scope = 'all_users', userId, mode = 'test' } = await req.json()
    
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log(`🔥 BACKFILL: Starting backfill process for SELL trade snapshots (scope: ${scope}, mode: ${mode})`)

    // Get all users who have SELL trades missing snapshots
    let usersQuery = supabase
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
    let totalSkipped = 0
    const results: any[] = []

    // Process each user
    for (const userId of uniqueUserIds) {
      console.log(`🔥 BACKFILL: Processing user ${userId}`)

      // Get user profile for fee calculation
      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', userId)
        .single()

      const accountType = profile?.username?.includes('coinbase') ? 'COINBASE_PRO' : 'OTHER'
      const feeRate = getFeeRate(accountType)

      // Get all trades for this user, ordered chronologically
      const { data: allTrades, error: tradesError } = await supabase
        .from('mock_trades')
        .select('*')
        .eq('user_id', userId)
        .order('executed_at', { ascending: true })

      if (tradesError) {
        console.error(`❌ BACKFILL: Error fetching trades for user ${userId}:`, tradesError)
        continue
      }

      // Process trades per cryptocurrency
      const cryptoTrades: Record<string, Trade[]> = {}
      
      // Group trades by cryptocurrency
      for (const trade of allTrades || []) {
        if (!cryptoTrades[trade.cryptocurrency]) {
          cryptoTrades[trade.cryptocurrency] = []
        }
        cryptoTrades[trade.cryptocurrency].push(trade)
      }

      // Process each cryptocurrency separately
      for (const [crypto, trades] of Object.entries(cryptoTrades)) {
        console.log(`🔥 BACKFILL: Processing ${crypto} trades for user ${userId}`)

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
              totalSkipped++
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

            // Calculate snapshot data
            const original_purchase_amount = allocation.reduce((sum, a) => sum + a.matchedAmount, 0)
            const original_purchase_value = round2(allocation.reduce((sum, a) => sum + a.buyValuePortion, 0))
            const original_purchase_price = original_purchase_amount > 0 
              ? round6(original_purchase_value / original_purchase_amount) 
              : 0

            const exit_value = round2(trade.price * trade.amount)
            const buy_fees = round2(original_purchase_value * feeRate)
            const sell_fees = round2(exit_value * feeRate)
            const realized_pnl = round2((exit_value - sell_fees) - (original_purchase_value + buy_fees))
            const realized_pnl_pct = original_purchase_value > 0
              ? round2((realized_pnl / original_purchase_value) * 100)
              : 0

            // Update the SELL trade with snapshot data
            const { error: updateError } = await supabase
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

            if (updateError) {
              console.error(`❌ BACKFILL: Error updating SELL ${trade.id}:`, updateError)
            } else {
              console.log(`✅ BACKFILL: Updated SELL ${trade.id} with snapshot data`)
              totalUpdated++
              
              // Store example for reporting
              if (results.length < 5) {
                results.push({
                  trade_id: trade.id,
                  user_id: userId,
                  cryptocurrency: crypto,
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

            // Update lot remaining amounts for future SELLs
            for (const lot of buyLots) {
              const matchedAllocation = allocation.find(a => a.lotId === lot.id)
              if (matchedAllocation) {
                lot.remaining -= matchedAllocation.matchedAmount
              }
            }
          }
        }
      }
    }

    const endTime = Date.now()
    console.log(`🔥 BACKFILL: Completed. Updated: ${totalUpdated}, Skipped: ${totalSkipped}`)

    return new Response(
      JSON.stringify({
        success: true,
        scope,
        userId: scope === 'single_user' ? userId : undefined,
        sell_total: totalUpdated + totalSkipped,
        sell_updated: totalUpdated,
        sell_skipped: totalSkipped,
        started_at: new Date(startTime).toISOString(),
        ended_at: new Date(endTime).toISOString(),
        duration_ms: endTime - startTime,
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