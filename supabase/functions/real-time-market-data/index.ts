// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MarketDataRequest {
  symbols: string[]
  action: 'subscribe' | 'unsubscribe' | 'get_current'
}

interface CoinbaseTickerMessage {
  type: string
  product_id: string
  price: string
  time: string
  sequence: number
  bid: string
  ask: string
  volume_24h: string
}

serve(async (req) => {
  console.log(`=== Real-time Market Data Function Called ===`)
  console.log(`Request method: ${req.method}`)
  console.log(`Request URL: ${req.url}`)
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Helper function to store price data in database
    const storePriceData = async (marketData: any, sourceId: string, userId: string) => {
      try {
        const priceEntry = {
          symbol: marketData.symbol,
          timestamp: new Date(marketData.timestamp).toISOString(),
          open_price: parseFloat(marketData.price),
          high_price: parseFloat(marketData.high_24h || marketData.price),
          low_price: parseFloat(marketData.low_24h || marketData.price),
          close_price: parseFloat(marketData.price),
          volume: parseFloat(marketData.volume || '0'),
          source: marketData.source || 'coinbase_api',
          source_id: sourceId,
          user_id: userId,
          interval_type: 'realtime',
          metadata: {
            bid: marketData.bid,
            ask: marketData.ask,
            change_24h: marketData.change_24h,
            change_percentage_24h: marketData.change_percentage_24h
          }
        }
        
        const { error } = await supabase.from('price_data').insert(priceEntry)
        if (error) {
          console.error('Failed to store price data:', error)
        } else {
          console.log(`✅ Stored price data for ${marketData.symbol} at ${marketData.price}`)
        }
      } catch (error) {
        console.error('Error storing price data:', error)
      }
    }

    if (req.method === 'POST') {
      const { symbols, action }: MarketDataRequest = await req.json()
      
      if (action === 'get_current') {
        console.log(`📊 Fetching current market data for symbols: ${symbols.join(', ')}`)
        const marketData: Record<string, any> = {}
        
        // Get a data source ID for storage
        const { data: dataSources } = await supabase
          .from('ai_data_sources')
          .select('id, user_id')
          .eq('source_name', 'coinbase_api')
          .eq('is_active', true)
          .limit(1)
        
        const sourceId = dataSources?.[0]?.id || crypto.randomUUID()
        const userId = dataSources?.[0]?.user_id || crypto.randomUUID()
        
        for (const symbol of symbols) {
          try {
            console.log(`🔍 Fetching data for ${symbol}`)
            
            // Get current ticker data from Coinbase Pro API
            const tickerResponse = await fetch(
              `https://api.exchange.coinbase.com/products/${symbol}/ticker`
            )
            
            if (tickerResponse.ok) {
              const tickerData = await tickerResponse.json()
              console.log(`📈 Ticker data for ${symbol}: Price=${tickerData.price}`)
              
              // Get 24h stats
              const statsResponse = await fetch(
                `https://api.exchange.coinbase.com/products/${symbol}/stats`
              )
              
              let statsData = null
              if (statsResponse.ok) {
                statsData = await statsResponse.json()
                console.log(`📊 Stats data for ${symbol}: High=${statsData.high}, Low=${statsData.low}`)
              }
              
              const currentData = {
                symbol,
                price: parseFloat(tickerData.price || '0'),
                bid: parseFloat(tickerData.bid || '0'),
                ask: parseFloat(tickerData.ask || '0'),
                volume: parseFloat(tickerData.volume || '0'),
                change_24h: statsData?.open || '0',
                change_percentage_24h: '0', // Calculate this
                high_24h: statsData?.high || tickerData.price,
                low_24h: statsData?.low || tickerData.price,
                timestamp: new Date().toISOString(),
                source: 'coinbase_public_api'
              }
              
              // Store in database
              await storePriceData(currentData, sourceId, userId)
              
              marketData[symbol] = currentData
            } else {
              console.error(`❌ Failed to fetch ticker for ${symbol}: HTTP ${tickerResponse.status}`)
              // No fallback - report the actual error
              marketData[symbol] = {
                symbol,
                error: `API returned ${tickerResponse.status}`,
                timestamp: new Date().toISOString(),
                source: 'api_error'
              }
            }
          } catch (error) {
            console.error(`💥 Error fetching data for ${symbol}:`, error)
            marketData[symbol] = {
              symbol,
              error: error.message,
              timestamp: new Date().toISOString(),
              source: 'fetch_error'
            }
          }
        }
        
        return new Response(
          JSON.stringify({ success: true, data: marketData }),
          { 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200 
          }
        )
      }
    }

    // Polling endpoint for automated data collection
    if (req.method === 'GET') {
      console.log(`🔄 Starting automated price data collection`)
      
      const symbols = ['BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'LTC-EUR', 'ADA-EUR', 'DOT-EUR', 'LINK-EUR', 'BCH-EUR', 'SOL-EUR', 'MATIC-EUR', 'AVAX-EUR']
      const results = []
      
      // Get or create data source
      let { data: dataSource } = await supabase
        .from('ai_data_sources')
        .select('id, user_id')
        .eq('source_name', 'coinbase_realtime')
        .eq('is_active', true)
        .single()
      
      if (!dataSource) {
        // Create default data source
        const { data: newSource } = await supabase
          .from('ai_data_sources')
          .insert({
            source_name: 'coinbase_realtime',
            source_type: 'price_feed',
            api_endpoint: 'https://api.exchange.coinbase.com',
            is_active: true,
            update_frequency: 'realtime',
            configuration: { symbols },
            user_id: crypto.randomUUID()
          })
          .select()
          .single()
        
        dataSource = newSource
      }
      
      for (const symbol of symbols) {
        try {
          const tickerResponse = await fetch(
            `https://api.exchange.coinbase.com/products/${symbol}/ticker`
          )
          
          if (tickerResponse.ok) {
            const tickerData = await tickerResponse.json()
            
            const statsResponse = await fetch(
              `https://api.exchange.coinbase.com/products/${symbol}/stats`
            )
            
            let statsData = null
            if (statsResponse.ok) {
              statsData = await statsResponse.json()
            }
            
            const marketData = {
              symbol,
              price: parseFloat(tickerData.price || '0'),
              bid: parseFloat(tickerData.bid || '0'),
              ask: parseFloat(tickerData.ask || '0'),
              volume: parseFloat(tickerData.volume || '0'),
              high_24h: statsData?.high || tickerData.price,
              low_24h: statsData?.low || tickerData.price,
              timestamp: new Date().toISOString(),
              source: 'automated_coinbase_poll'
            }
            
            // Store in database
            await storePriceData(marketData, dataSource.id, dataSource.user_id)
            results.push({ symbol, status: 'success', price: marketData.price })
            
          } else {
            console.error(`Failed to fetch ${symbol}: HTTP ${tickerResponse.status}`)
            results.push({ symbol, status: 'failed', error: `HTTP ${tickerResponse.status}` })
          }
        } catch (error) {
          console.error(`Error fetching ${symbol}:`, error)
          results.push({ symbol, status: 'error', error: error.message })
        }
      }
      
      // Update last sync time
      await supabase
        .from('ai_data_sources')
        .update({ last_sync: new Date().toISOString() })
        .eq('id', dataSource.id)
      
      console.log(`✅ Automated collection complete. Results:`, results)
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Automated price data collection completed',
          results,
          timestamp: new Date().toISOString()
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405 
      }
    )

  } catch (error) {
    console.error('Error in real-time-market-data function:', error)
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})