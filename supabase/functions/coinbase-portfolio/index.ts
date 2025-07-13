
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

    // Get user's Coinbase connections
    const { data: connections, error: connectionsError } = await supabase
      .from('coinbase_connections')
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
    console.log('Found connection:', connection.connection_name);

    // Handle OAuth credentials vs API keys
    if (!connection.api_key_encrypted || !connection.api_private_key_encrypted) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'API credentials not found for this connection' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const clientId = connection.api_key_encrypted;
    const clientSecret = connection.api_private_key_encrypted;
    
    console.log('Using OAuth Client ID:', clientId.substring(0, 8) + '...');

    // Check if these look like OAuth credentials (UUID format) vs API keys
    const isOAuthCredentials = clientId.includes('-') && clientId.length > 30;
    
    if (isOAuthCredentials) {
      // OAuth flow - get access token first
      console.log('Using OAuth flow to get access token');
      
      const tokenUrl = connection.is_sandbox 
        ? 'https://api.sandbox.coinbase.com/oauth/token' 
        : 'https://api.coinbase.com/oauth/token';
      
      // For machine-to-machine OAuth, use client credentials grant
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'wallet:accounts:read'
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('OAuth token error:', errorText);
        return new Response(JSON.stringify({ 
          success: false, 
          error: `OAuth authentication failed: ${tokenResponse.status} - ${errorText}` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const tokenData = await tokenResponse.json();
      const accessToken = tokenData.access_token;
      
      console.log('Got OAuth access token');

      // Use the access token to call Coinbase API
      const baseUrl = connection.is_sandbox 
        ? 'https://api.sandbox.coinbase.com' 
        : 'https://api.coinbase.com';
      
      const apiPath = '/v2/accounts';
      console.log('Calling Coinbase API with OAuth:', baseUrl + apiPath);
      
      const response = await fetch(baseUrl + apiPath, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'CB-VERSION': '2023-01-05',
        },
      });

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
      console.log('Coinbase accounts fetched via OAuth:', accountsData?.data?.length || 'No accounts');

      return new Response(JSON.stringify({ 
        success: true,
        message: 'Portfolio data fetched successfully via OAuth',
        connection: {
          name: connection.connection_name,
          is_sandbox: connection.is_sandbox,
          connected_at: connection.connected_at,
          auth_method: 'oauth'
        },
        accounts: accountsData.data || [],
        balances: accountsData.data || []
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } else {
      // API Key flow (HMAC authentication)
      console.log('Using API Key authentication');
      
      const apiKey = clientId;
      const apiSecret = clientSecret;
      
      // Generate timestamp and signature for Coinbase API
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const method = 'GET';
      const path = '/accounts';
      const body = '';
      
      const message = timestamp + method + path + body;
      
      // Create HMAC signature
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
      
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
      const signatureHex = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Use Coinbase Advanced Trade API (no passphrase needed)
      const baseUrl = connection.is_sandbox 
        ? 'https://api.sandbox.coinbase.com' 
        : 'https://api.coinbase.com';
      
      console.log('Calling Coinbase Advanced Trade API:', baseUrl + path);
      
      const response = await fetch(baseUrl + path, {
        method: 'GET',
        headers: {
          'CB-ACCESS-KEY': apiKey,
          'CB-ACCESS-SIGN': signatureHex,
          'CB-ACCESS-TIMESTAMP': timestamp,
        },
      });

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

      const accounts = await response.json();
      console.log('Coinbase accounts fetched via API keys:', accounts.length || 'No accounts');

      return new Response(JSON.stringify({ 
        success: true,
        message: 'Portfolio data fetched successfully via API keys',
        connection: {
          name: connection.connection_name,
          is_sandbox: connection.is_sandbox,
          connected_at: connection.connected_at,
          auth_method: 'api_keys'
        },
        accounts: accounts,
        balances: accounts
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
