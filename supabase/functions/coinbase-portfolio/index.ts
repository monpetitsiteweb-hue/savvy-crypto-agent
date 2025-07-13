
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

    // Get user's OAuth connections
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
        error: 'No active Coinbase OAuth connections found. Please connect your Coinbase account first.' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const connection = connections[0];
    console.log('Found OAuth connection for user:', connection.coinbase_user_id);

    // OAuth token authentication for Coinbase API
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
    const path = '/v2/accounts';
    const fullUrl = baseUrl + path;
    console.log('Calling Coinbase OAuth API:', fullUrl);
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'CB-VERSION': '2023-08-01',
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

    const accountsData = await response.json();
    console.log('Coinbase accounts fetched:', accountsData?.accounts?.length || 'No accounts found');

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Portfolio data fetched successfully',
      connection: {
        name: 'Coinbase OAuth',
        is_sandbox: false,
        connected_at: connection.connected_at,
        last_sync: new Date().toISOString(),
        auth_method: 'oauth'
      },
      accounts: accountsData.data || [],
      balances: accountsData.data || []
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
