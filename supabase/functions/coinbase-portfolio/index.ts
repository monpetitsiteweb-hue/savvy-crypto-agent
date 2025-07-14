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
      
      // Decrypt the API credentials (simplified for now)
      // Note: In production, you would properly decrypt these
      const apiName = connection.api_name_encrypted; // This would be decrypted
      const apiKey = connection.api_identifier_encrypted; // This would be decrypted
      const apiSecret = connection.api_private_key_encrypted; // This would be decrypted
      
      // Make request to Coinbase API
      try {
        console.log('Fetching portfolio from Coinbase API...');
        
        // For now, return a success message indicating the connection is ready
        return new Response(JSON.stringify({ 
          success: true,
          message: 'API key connection detected - ready to fetch portfolio',
          connectionType: 'api_key',
          connectionId: connection.id,
          apiName: 'Hidden for security'
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