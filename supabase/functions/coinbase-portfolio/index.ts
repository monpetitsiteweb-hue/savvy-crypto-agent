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
    console.log('Coinbase portfolio function called');
    
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header provided');
      return new Response(JSON.stringify({ error: 'Authorization header required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Verify the JWT token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      console.error('User authentication failed:', userError);
      return new Response(JSON.stringify({ 
        error: 'Authentication failed',
        details: userError?.message 
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('User authenticated:', user.id);

    // Get user's active Coinbase connections
    const { data: connections, error: connectionError } = await supabaseClient
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (connectionError) {
      console.error('Error fetching connections:', connectionError);
      return new Response(JSON.stringify({ error: 'Failed to fetch connections' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!connections || connections.length === 0) {
      console.log('No active connections found');
      return new Response(JSON.stringify({ 
        error: 'No active Coinbase connections found',
        message: 'Please connect your Coinbase account first'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${connections.length} active connection(s)`);

    // For now, use the first connection
    const connection = connections[0];
    
    // Check if it's OAuth or API key connection
    if (connection.access_token_encrypted) {
      // OAuth connection - implement OAuth flow
      console.log('Using OAuth connection');
      return new Response(JSON.stringify({ 
        success: true,
        message: 'OAuth connection detected - portfolio fetching will be implemented next',
        connectionType: 'oauth',
        connectionId: connection.id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else if (connection.api_identifier_encrypted && connection.api_private_key_encrypted) {
      // API key connection - implement API key flow
      console.log('Using API key connection');
      
      // For now, we'll use the encrypted values directly (in production, these would be properly decrypted)
      const apiKey = connection.api_identifier_encrypted;
      const apiSecret = connection.api_private_key_encrypted;
      
      // Create timestamp for API request
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const method = 'GET';
      const requestPath = '/v2/accounts';
      
      // Create signature for Coinbase API
      const message = timestamp + method + requestPath;
      
      try {
        console.log('Fetching portfolio from Coinbase API...');
        
        // Import crypto for HMAC
        const crypto = await import('node:crypto');
        const signature = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
        
        // Make request to Coinbase API
        const coinbaseResponse = await fetch(`https://api.coinbase.com${requestPath}`, {
          method: method,
          headers: {
            'CB-ACCESS-KEY': apiKey,
            'CB-ACCESS-SIGN': signature,
            'CB-ACCESS-TIMESTAMP': timestamp,
            'CB-VERSION': '2021-06-25',
            'Content-Type': 'application/json',
          },
        });
        
        const portfolioData = await coinbaseResponse.json();
        console.log('Coinbase API response status:', coinbaseResponse.status);
        
        if (!coinbaseResponse.ok) {
          console.error('Coinbase API error:', portfolioData);
          return new Response(JSON.stringify({ 
            error: 'Failed to fetch portfolio from Coinbase',
            details: portfolioData.errors || portfolioData.message || 'API request failed',
            status: coinbaseResponse.status
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        return new Response(JSON.stringify({ 
          success: true,
          message: `Successfully fetched ${portfolioData.data?.length || 0} accounts from Coinbase`,
          data: portfolioData.data,
          connectionType: 'api_key',
          connectionId: connection.id
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
        
      } catch (apiError) {
        console.error('Coinbase API error:', apiError);
        return new Response(JSON.stringify({ 
          error: 'Failed to fetch portfolio from Coinbase',
          details: apiError instanceof Error ? apiError.message : 'Unknown error'
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      console.log('Invalid connection - missing credentials');
      return new Response(JSON.stringify({ 
        error: 'Invalid connection - missing credentials',
        message: 'Connection found but credentials are incomplete'
      }), {
        status: 400,
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