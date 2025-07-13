
import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    console.log('=== Coinbase Portfolio Function Called ===');
    console.log('Request method:', req.method);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Authentication required' 
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('User authenticated:', user.id);

    // Get user's connections (both OAuth and API)
    const { data: connections, error: connectionsError } = await supabase
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (connectionsError) {
      console.error('Database error:', connectionsError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to fetch connections' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!connections || connections.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No active Coinbase connections found. Please connect your Coinbase account first.' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const connection = connections[0];
    console.log('Found connection for user:', connection.coinbase_user_id || 'API connection');

    // Determine connection type
    const isApiConnection = connection.coinbase_user_id === 'api_user';
    const isOAuthConnection = !isApiConnection && connection.coinbase_user_id;

    let response;
    let authMethod;

    if (isApiConnection) {
      // API Key authentication
      console.log('Using API key authentication');
      
      if (!connection.access_token_encrypted || !connection.refresh_token_encrypted) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'API credentials not found for this connection' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const apiKey = connection.access_token_encrypted;
      const apiSecret = connection.refresh_token_encrypted;
      console.log('Using API key:', apiKey.substring(0, 10) + '...');

      // Use Coinbase Advanced Trade API with HMAC-SHA256 (standard method)
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const method = 'GET';
      const requestPath = '/api/v3/brokerage/accounts';
      const body = '';
      
      // Create HMAC-SHA256 signature for Coinbase Advanced Trade API
      const message = timestamp + method + requestPath + body;
      console.log('Message to sign:', message);
      
      const encoder = new TextEncoder();
      const keyData = encoder.encode(apiSecret);
      const messageData = encoder.encode(message);
      
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      
      const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
      const signature = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      console.log('Generated signature:', signature.substring(0, 20) + '...');

      const baseUrl = 'https://api.coinbase.com';
      const fullUrl = baseUrl + requestPath;
      console.log('Calling Coinbase API with API keys:', fullUrl);
      
      response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'CB-ACCESS-KEY': apiKey,
          'CB-ACCESS-SIGN': signature,
          'CB-ACCESS-TIMESTAMP': timestamp.toString(),
          'Content-Type': 'application/json',
        },
      });
      
      authMethod = 'api_key';
      
    } else if (isOAuthConnection) {
      // OAuth token authentication
      console.log('Using OAuth token authentication');
      
      if (!connection.access_token_encrypted) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'OAuth access token not found for this connection' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check if token is expired
      if (connection.expires_at && new Date(connection.expires_at) < new Date()) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'OAuth token has expired. Please reconnect your Coinbase account.' 
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const accessToken = connection.access_token_encrypted;
      console.log('Using OAuth token:', accessToken.substring(0, 10) + '...');

      // Use Coinbase API with OAuth
      const baseUrl = 'https://api.coinbase.com';
      const requestPath = '/v2/accounts';
      const fullUrl = baseUrl + requestPath;
      console.log('Calling Coinbase OAuth API:', fullUrl);
      
      response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'CB-VERSION': '2023-08-01',
        },
      });
      
      authMethod = 'oauth';
      
    } else {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Invalid connection type. Connection must be either OAuth or API key based.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Coinbase API Response Status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Coinbase API Error:', errorText);
      return new Response(JSON.stringify({ 
        success: false, 
        error: `Coinbase API error: ${response.status} - ${errorText}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accountsData = await response.json();
    
    // Handle different response formats for OAuth vs API
    let accounts = [];
    if (authMethod === 'oauth') {
      accounts = accountsData.data || [];
      console.log('OAuth accounts fetched:', accounts.length);
    } else {
      accounts = accountsData.accounts || [];
      console.log('API accounts fetched:', accounts.length);
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Portfolio data fetched successfully',
      connection: {
        name: isApiConnection ? 'Coinbase API Keys' : 'Coinbase OAuth',
        is_sandbox: false,
        connected_at: connection.connected_at,
        last_sync: new Date().toISOString(),
        auth_method: authMethod
      },
      accounts: accounts,
      balances: accounts
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in coinbase-portfolio function:', error);
    
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
