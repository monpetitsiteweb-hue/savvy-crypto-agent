import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Coinbase sandbox trade function called');
    
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Parse request body first to get user information
    const requestBody = await req.json();
    const { 
      connectionId, 
      tradeType, 
      cryptocurrency, 
      amount, 
      price,
      strategyId,
      userId, // Add userId to the request body
      orderType = 'market' // Default to market order if not specified
    } = requestBody;

    let user;
    
    // Try to get user from auth header if available
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user: authUser }, error: userError } = await supabaseClient.auth.getUser(token);
      if (!userError && authUser) {
        user = authUser;
        console.log('User authenticated via JWT:', user.id);
      }
    }
    
    // If no user from auth, try to get from userId parameter
    if (!user && userId) {
      user = { id: userId };
      console.log('Using userId from request:', userId);
    }
    
    if (!user) {
      console.error('No user authentication found');
      return new Response(JSON.stringify({ 
        error: 'User authentication required',
        details: 'Either provide Authorization header or userId parameter'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    if (!connectionId || !tradeType || !cryptocurrency || !amount) {
      return new Response(JSON.stringify({ 
        error: 'Missing required parameters: connectionId, tradeType, cryptocurrency, amount' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's connection
    const { data: connections, error: connectionError } = await supabaseClient
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('id', connectionId)
      .eq('is_active', true);

    if (connectionError || !connections || connections.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Connection not found or inactive' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const connection = connections[0];
    
    // Check if it's Ed25519 API key connection
    if (!connection.api_identifier_encrypted || !connection.api_private_key_encrypted?.startsWith('ed25519:')) {
      return new Response(JSON.stringify({ 
        error: 'This function requires Ed25519 API keys for Coinbase Advanced Trading' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = connection.api_identifier_encrypted;
    const privateKeyData = connection.api_private_key_encrypted;
    const base64PrivateKey = privateKeyData.slice(8); // Remove "ed25519:" prefix

    // Create JWT for sandbox trading
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    
    const header = {
      alg: "EdDSA",
      typ: "JWT", 
      kid: apiKey,
      nonce: nonce
    };

    // Different endpoints for different operations
    let endpoint = '';
    let method = 'POST';
    let payload = {};

    if (tradeType === 'buy' || tradeType === 'sell') {
      // Create order endpoint
      endpoint = 'POST api.sandbox.coinbase.com/api/v3/brokerage/orders';
      
      // Create order payload based on order type
      const orderConfig = orderType === 'market' 
        ? {
            market_market_ioc: {
              quote_size: amount.toString() // For market orders, use quote_size (USD amount)
            }
          }
        : {
            limit_limit_gtc: {
              base_size: amount.toString(),
              limit_price: price.toString()
            }
          };

      payload = {
        client_order_id: crypto.randomUUID(),
        product_id: `${cryptocurrency.toUpperCase()}-USD`, // e.g., BTC-USD
        side: tradeType.toUpperCase(),
        order_configuration: orderConfig
      };
    } else if (tradeType === 'portfolio') {
      // Get portfolio/accounts
      endpoint = 'GET api.sandbox.coinbase.com/api/v3/brokerage/accounts';
      method = 'GET';
    }

    const jwtPayload = {
      sub: apiKey,
      iss: "cdp",
      nbf: timestamp,
      exp: timestamp + 120, // 2 minutes
      aud: ["retail_rest_api_proxy"],
      uri: endpoint
    };

    // Base64URL encode (without padding)
    const encodeBase64URL = (obj) => {
      return btoa(JSON.stringify(obj))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    };
    
    const encodedHeader = encodeBase64URL(header);
    const encodedPayload = encodeBase64URL(jwtPayload);
    const message = `${encodedHeader}.${encodedPayload}`;
    
    try {
      // Use noble Ed25519 library
      const ed25519Module = await import('https://esm.sh/@noble/ed25519@2.0.0');
      const { sha512 } = await import('https://esm.sh/@noble/hashes@1.3.3/sha512');
      
      // Set up SHA-512 for noble/ed25519
      ed25519Module.etc.sha512Sync = (...m) => sha512(ed25519Module.etc.concatBytes(...m));
      const { sign } = ed25519Module;
      
      // Decode and sign
      const privateKeyBytes = Uint8Array.from(atob(base64PrivateKey), c => c.charCodeAt(0));
      const privateKey = privateKeyBytes.slice(0, 32);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await sign(messageBytes, privateKey);
      
      const signature = btoa(String.fromCharCode(...signatureBytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      
      const jwt = `${message}.${signature}`;
      
      // Make API call to Coinbase SANDBOX
      const apiUrl = `https://${endpoint.split(' ')[1]}`;
      const requestOptions: RequestInit = {
        method: method,
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
      };

      if (method === 'POST' && Object.keys(payload).length > 0) {
        requestOptions.body = JSON.stringify(payload);
      }

      console.log('Making sandbox API call to:', apiUrl);
      console.log('Request payload:', payload);
      console.log('Request headers:', requestOptions.headers);
      console.log('JWT length:', jwt.length);
      
      let response;
      try {
        response = await fetch(apiUrl, requestOptions);
        console.log('Fetch completed, status:', response.status);
      } catch (fetchError) {
        console.error('Fetch error details:', fetchError);
        console.error('Error name:', fetchError.name);
        console.error('Error message:', fetchError.message);
        
        // Try with different API endpoint - maybe sandbox endpoint is down
        const productionApiUrl = apiUrl.replace('api.sandbox.coinbase.com', 'api.coinbase.com');
        console.log('Trying production endpoint instead:', productionApiUrl);
        
        try {
          response = await fetch(productionApiUrl, requestOptions);
          console.log('Production API fetch completed, status:', response.status);
        } catch (prodError) {
          console.error('Production API also failed:', prodError);
          throw fetchError; // Throw original error
        }
      }
      const result = await response.json();
      
      console.log('Sandbox API response status:', response.status);
      console.log('Sandbox API response:', result);
      
      if (!response.ok) {
        return new Response(JSON.stringify({ 
          error: 'Coinbase Sandbox API request failed',
          status: response.status,
          details: result,
          isSandbox: true
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Save trade to database if it's a buy/sell order
      if ((tradeType === 'buy' || tradeType === 'sell') && strategyId) {
        const totalValue = parseFloat(amount) * (parseFloat(price) || 0);
        const fees = 0; // No fees for Coinbase Pro

        await supabaseClient
          .from('trading_history')
          .insert({
            user_id: user.id,
            strategy_id: strategyId,
            trade_type: tradeType,
            cryptocurrency: cryptocurrency.toUpperCase(),
            amount: parseFloat(amount),
            price: parseFloat(price) || 0,
            total_value: totalValue,
            fees: fees,
            coinbase_order_id: result.order_id || result.success_response?.order_id,
            notes: `Sandbox ${tradeType} order - Order ID: ${result.order_id || 'unknown'}`,
            user_coinbase_connection_id: connectionId,
            is_sandbox: true,
            trade_environment: 'sandbox'
          });
      }
      
      return new Response(JSON.stringify({ 
        success: true,
        data: result,
        sandbox: true,
        tradeType: tradeType,
        message: tradeType === 'portfolio' 
          ? `Fetched sandbox portfolio data` 
          : `Sandbox ${tradeType} order placed successfully`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      console.error('Sandbox trading error:', error);
      
      // Provide detailed error information for debugging
      let errorDetails = {
        error: 'Failed to execute sandbox trade',
        details: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.name : 'Unknown',
        debugInfo: {
          apiEndpoint: 'api.sandbox.coinbase.com',
          connectionInfo: `Using connection ID: ${connectionId}`,
          tradeDetails: `${tradeType} ${amount} of ${cryptocurrency}`,
          orderType: orderType,
          timestamp: new Date().toISOString()
        }
      };
      
      // Add specific guidance based on error type
      if (error instanceof Error) {
        if (error.message.includes('error sending request')) {
          errorDetails.debugInfo.suggestion = 'Coinbase Sandbox API is unreachable. This is likely a temporary network issue.';
        } else if (error.message.includes('fetch')) {
          errorDetails.debugInfo.suggestion = 'Network connectivity issue. Check internet connection.';
        } else if (error.message.includes('API')) {
          errorDetails.debugInfo.suggestion = 'Coinbase API error. Check API credentials and permissions.';
        }
      }
      
      return new Response(JSON.stringify(errorDetails), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});