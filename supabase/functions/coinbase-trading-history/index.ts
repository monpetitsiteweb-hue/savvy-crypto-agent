import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    console.log('Request body:', requestBody);
    
    const { connectionId, testMode = false } = requestBody;
    console.log('Connection ID:', connectionId, 'Type:', typeof connectionId);
    console.log('Test Mode:', testMode);
    
    if (!connectionId) {
      console.log('No connection ID provided');
      return new Response(
        JSON.stringify({ error: 'Connection ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    console.log('Supabase URL:', supabaseUrl ? 'Present' : 'Missing');
    console.log('Service Key:', supabaseServiceKey ? 'Present' : 'Missing');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the connection details
    const { data: connection, error: connectionError } = await supabase
      .from('user_coinbase_connections')
      .select('*')
      .eq('id', connectionId)
      .maybeSingle();

    if (connectionError) {
      console.error('Connection error:', connectionError);
      return new Response(
        JSON.stringify({ error: 'Database error while fetching connection', details: connectionError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!connection) {
      console.error('No connection found for ID:', connectionId);
      return new Response(
        JSON.stringify({ error: 'Connection not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch actual trading history from Coinbase API
    let tradingHistory = [];
    
    try {
      if (connection.api_identifier_encrypted && connection.api_private_key_encrypted) {
        console.log('Using API key connection');
        
        // Decrypt the stored credentials (in a real implementation, these would be properly encrypted)
        // For now, we assume they're base64 encoded
        const apiKey = connection.api_identifier_encrypted;
        const privateKeyBase64 = connection.api_private_key_encrypted;
        
        console.log('Processing Ed25519 key for Coinbase Advanced Trading API');
        
        // Extract the base64 key content - handle both PEM and raw base64 formats
        let cleanPrivateKey = privateKeyBase64;
        
        // Remove PEM headers if present
        if (cleanPrivateKey.includes('-----BEGIN PRIVATE KEY-----')) {
          cleanPrivateKey = cleanPrivateKey
            .replace(/-----BEGIN PRIVATE KEY-----/, '')
            .replace(/-----END PRIVATE KEY-----/, '')
            .replace(/\n/g, '')
            .replace(/\r/g, '')
            .replace(/\s+/g, '');
        } else {
          // Already base64, just clean whitespace
          cleanPrivateKey = cleanPrivateKey.replace(/\s+/g, '');
        }
        
        console.log('Base64 key extracted, length:', cleanPrivateKey.length);
        
        let privateKeyBytes;
        try {
          // Try to decode the base64
          privateKeyBytes = Uint8Array.from(atob(cleanPrivateKey), c => c.charCodeAt(0));
          console.log('Successfully decoded private key, bytes length:', privateKeyBytes.length);
        } catch (decodeError) {
          console.error('Base64 decode error:', decodeError);
          console.log('Attempting to use key as-is for Coinbase API...');
          
          // For Coinbase API keys, sometimes they're stored as-is, not base64 encoded
          // Let's try using the original key directly
          try {
            privateKeyBytes = new TextEncoder().encode(connection.api_private_key_encrypted);
            console.log('Using raw key as text, length:', privateKeyBytes.length);
          } catch (textError) {
            console.error('Failed to use key as text:', textError);
            throw new Error('Invalid private key format - cannot decode or use as text');
          }
        }
        console.log('Private key bytes length:', privateKeyBytes.length);
        
        // For Ed25519, we need the raw 32-byte private key (skip the ASN.1 wrapper if present)
        const ed25519PrivateKey = privateKeyBytes.length === 32 ? 
          privateKeyBytes : 
          privateKeyBytes.slice(-32); // Take last 32 bytes
        
        console.log('Using private key length:', ed25519PrivateKey.length);
        
        // Create JWT token for Coinbase Advanced Trading API
        const now = Math.floor(Date.now() / 1000);
        const uri = '/api/v3/brokerage/orders/historical/batch';
        const method = 'GET';
        
        const message = `${now}${method}${uri}`;
        console.log('Message to sign length:', message.length);
        
        // Import the Ed25519 key for signing
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          ed25519PrivateKey,
          { name: 'Ed25519' },
          false,
          ['sign']
        );
        
        const signature = await crypto.subtle.sign(
          'Ed25519',
          cryptoKey,
          new TextEncoder().encode(message)
        );
        
        const signatureHex = Array.from(new Uint8Array(signature))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        
        console.log('Signature created, length:', signatureHex.length);
        
        // Create JWT
        const header = {
          alg: 'ES256',
          kid: apiKey,
          nonce: crypto.randomUUID().replace(/-/g, '')
        };
        
        const payload = {
          sub: apiKey,
          iss: 'cdp',
          nbf: now,
          exp: now + 120,
          uri: uri
        };
        
        const headerB64 = btoa(JSON.stringify(header)).replace(/[+/]/g, c => c === '+' ? '-' : '_').replace(/=/g, '');
        const payloadB64 = btoa(JSON.stringify(payload)).replace(/[+/]/g, c => c === '+' ? '-' : '_').replace(/=/g, '');
        const jwt = `${headerB64}.${payloadB64}.${signatureHex.slice(0, 86)}`;
        
        console.log('JWT created successfully, length:', jwt.length);
        
        // Make the API call to Coinbase
        const response = await fetch('https://api.coinbase.com/api/v3/brokerage/orders/historical/batch', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${jwt}`,
            'Content-Type': 'application/json'
          }
        });
        
        console.log('Coinbase API response status:', response.status);
        console.log('Coinbase API response headers:', Object.fromEntries(response.headers.entries()));
        
        if (response.ok) {
          const data = await response.json();
          console.log('Coinbase API response:', data);
          
          if (data.orders && Array.isArray(data.orders)) {
            // Filter for filled orders only
            tradingHistory = data.orders.filter(order => 
              order.status === 'FILLED' && 
              order.filled_size && 
              parseFloat(order.filled_size) > 0
            );
          }
        } else {
          const errorText = await response.text();
          console.error('Coinbase API error:', response.status, errorText);
          throw new Error(`Coinbase API error: ${response.status} ${errorText}`);
        }
      } else {
        console.log('No API credentials found, using mock data');
        throw new Error('No API credentials available');
      }
    } catch (apiError) {
      console.error('Error fetching from Coinbase API:', apiError);
      
      // DO NOT insert mock data - return empty array if API fails
      console.log('API failed, returning empty trading history instead of mock data');
      tradingHistory = [];
    }

    // Only insert data if we have actual trading history from Coinbase
    if (tradingHistory.length > 0) {
      console.log('About to insert trading history for user:', connection.user_id);
      
      // First, delete any existing data for this connection to avoid duplicates
      const { error: deleteError } = await supabase
        .from('trading_history')
        .delete()
        .eq('user_coinbase_connection_id', connectionId);

      if (deleteError) {
        console.error('Delete error:', deleteError);
        // Don't fail on delete error, just log it
      }

      // Convert Coinbase API format to our database format
      const tradesData = tradingHistory.map(order => {
        const cryptocurrency = order.product_id.split('-')[0]; // Extract crypto from pair like 'BTC-EUR'
        const price = parseFloat(order.filled_value) / parseFloat(order.filled_size);
        
        return {
          trade_type: order.side.toLowerCase(), // Convert 'BUY'/'SELL' to 'buy'/'sell'
          cryptocurrency: cryptocurrency,
          amount: parseFloat(order.filled_size),
          price: price,
          total_value: parseFloat(order.filled_value),
          executed_at: order.created_time,
          fees: parseFloat(order.total_fees || order.fill_fees || '0'),
          notes: `Coinbase ${order.order_type || 'market'} order`,
          user_id: connection.user_id,
          user_coinbase_connection_id: connectionId,
          coinbase_order_id: order.order_id,
          is_sandbox: testMode,
          trade_environment: testMode ? 'sandbox' : 'live'
        };
      });

      console.log('About to insert trades data:', tradesData);

      // Insert the trading history data
      const { error: insertError } = await supabase
        .from('trading_history')
        .insert(tradesData);

      if (insertError) {
        console.error('Insert error:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to save trading history', details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('Successfully inserted trading history');
    } else {
      console.log('No trading history from Coinbase API, not inserting any data');
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Trading history fetched successfully',
        trades: tradingHistory.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in coinbase-trading-history function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});