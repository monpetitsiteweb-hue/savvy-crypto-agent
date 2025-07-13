
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

    // Decrypt API credentials
    if (!connection.api_key_encrypted || !connection.api_private_key_encrypted) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'API credentials not found for this connection' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = connection.api_key_encrypted;
    const apiSecret = connection.api_private_key_encrypted;
    
    console.log('Using API Key:', apiKey.substring(0, 8) + '...');

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

    const accounts = await response.json();
    console.log('Coinbase accounts fetched:', accounts.length || 'No accounts');

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Portfolio data fetched successfully',
      connection: {
        name: connection.connection_name,
        is_sandbox: connection.is_sandbox,
        connected_at: connection.connected_at
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
