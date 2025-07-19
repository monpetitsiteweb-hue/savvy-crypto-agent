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
  console.log(`Request headers:`, Object.fromEntries(req.headers.entries()))
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log(`Handling OPTIONS request`)
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    if (req.method === 'POST') {
      const { symbols, action }: MarketDataRequest = await req.json()
      
      if (action === 'get_current') {
        // Fetch current market data for multiple symbols
        const marketData: Record<string, any> = {}
        
        for (const symbol of symbols) {
          try {
            console.log(`Fetching current data for ${symbol}`)
            
            // Get current ticker data from Coinbase Pro API (public)
            const tickerResponse = await fetch(
              `https://api.exchange.coinbase.com/products/${symbol}/ticker`
            )
            
            if (tickerResponse.ok) {
              const tickerData = await tickerResponse.json()
              console.log(`Ticker data for ${symbol}:`, tickerData)
              
              // Get 24h stats
              const statsResponse = await fetch(
                `https://api.exchange.coinbase.com/products/${symbol}/stats`
              )
              
              let statsData = null
              if (statsResponse.ok) {
                statsData = await statsResponse.json()
                console.log(`Stats data for ${symbol}:`, statsData)
              }
              
              marketData[symbol] = {
                symbol,
                price: parseFloat(tickerData.price || '0'),
                bid: parseFloat(tickerData.bid || '0'),
                ask: parseFloat(tickerData.ask || '0'),
                volume: parseFloat(tickerData.volume || '0'),
                change_24h: statsData?.price_change_24h || '0',
                change_percentage_24h: statsData?.price_change_percent_24h || '0',
                high_24h: statsData?.high_24h || '0',
                low_24h: statsData?.low_24h || '0',
                timestamp: new Date().toISOString(),
                source: 'coinbase_public_api'
              }
            } else {
              console.error(`Failed to fetch ticker for ${symbol}:`, tickerResponse.status)
              // Fallback mock data if API fails
              marketData[symbol] = {
                symbol,
                price: symbol === 'BTC-USD' ? 45000 : symbol === 'ETH-USD' ? 3000 : 100,
                bid: symbol === 'BTC-USD' ? 44995 : symbol === 'ETH-USD' ? 2995 : 99.95,
                ask: symbol === 'BTC-USD' ? 45005 : symbol === 'ETH-USD' ? 3005 : 100.05,
                volume: 1000000,
                change_24h: (Math.random() - 0.5) * 1000,
                change_percentage_24h: (Math.random() - 0.5) * 10,
                high_24h: symbol === 'BTC-USD' ? 46000 : symbol === 'ETH-USD' ? 3100 : 105,
                low_24h: symbol === 'BTC-USD' ? 44000 : symbol === 'ETH-USD' ? 2900 : 95,
                timestamp: new Date().toISOString(),
                source: 'fallback_mock'
              }
            }
          } catch (error) {
            console.error(`Error fetching data for ${symbol}:`, error)
            // Fallback data
            marketData[symbol] = {
              symbol,
              price: 0,
              error: error.message,
              timestamp: new Date().toISOString(),
              source: 'error_fallback'
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

    // WebSocket endpoint for real-time data
    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req)
      
      let coinbaseWs: WebSocket | null = null
      
      socket.onopen = () => {
        console.log("Client WebSocket connected")
        
        // Connect to Coinbase WebSocket
        coinbaseWs = new WebSocket('wss://advanced-trade-ws.coinbase.com')
        
        coinbaseWs.onopen = () => {
          console.log("Connected to Coinbase WebSocket")
          
          // Subscribe to default symbols
          const subscribeMessage = {
            "type": "subscribe",
            "product_ids": ["BTC-USD", "ETH-USD", "XRP-USD"],
            "channel": "ticker"
          }
          
          coinbaseWs?.send(JSON.stringify(subscribeMessage))
        }
        
        coinbaseWs.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            
            if (data.channel === 'ticker' && data.events) {
              // Forward real-time data to client
              socket.send(JSON.stringify({
                type: 'market_update',
                data: data.events[0]
              }))
            }
          } catch (error) {
            console.error("Error processing Coinbase message:", error)
          }
        }
        
        coinbaseWs.onerror = (error) => {
          console.error("Coinbase WebSocket error:", error)
          socket.send(JSON.stringify({
            type: 'error',
            message: 'Coinbase WebSocket connection failed'
          }))
        }
        
        coinbaseWs.onclose = () => {
          console.log("Coinbase WebSocket closed")
          socket.send(JSON.stringify({
            type: 'disconnected',
            message: 'Coinbase WebSocket disconnected'
          }))
        }
      }
      
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          
          if (message.type === 'subscribe' && message.symbols) {
            // Update subscription
            const subscribeMessage = {
              "type": "subscribe",
              "product_ids": message.symbols,
              "channel": "ticker"
            }
            
            coinbaseWs?.send(JSON.stringify(subscribeMessage))
          }
        } catch (error) {
          console.error("Error processing client message:", error)
        }
      }
      
      socket.onclose = () => {
        console.log("Client WebSocket disconnected")
        coinbaseWs?.close()
      }
      
      return response
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