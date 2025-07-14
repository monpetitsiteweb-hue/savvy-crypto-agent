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
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      console.log('Authentication failed:', userError?.message);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Authentication required',
        details: userError?.message 
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('User authenticated:', user.id);

    const { data: connections, error: connectionsError } = await supabase
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (connectionsError) {
      console.error('Database error:', connectionsError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to fetch connections',
        details: connectionsError.message 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Found connections:', connections?.length || 0);

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
    console.log('Connection details:', {
      coinbase_user_id: connection.coinbase_user_id,
      has_api_name: !!connection.api_name_encrypted,
      has_api_identifier: !!connection.api_identifier_encrypted,
      has_private_key: !!connection.api_private_key_encrypted,
      private_key_preview: connection.api_private_key_encrypted?.substring(0, 50) + '...'
    });

    // Extract key info
    let privateKeyRaw = connection.api_private_key_encrypted;
    console.log('Raw private key:', privateKeyRaw);

    let keyType = 'ecdsa';
    let privateKey = privateKeyRaw;
    
    if (privateKeyRaw && privateKeyRaw.includes(':')) {
      const parts = privateKeyRaw.split(':', 2);
      keyType = parts[0];
      privateKey = parts[1];
      console.log('Detected key type:', keyType);
      console.log('Extracted private key length:', privateKey?.length);
    }

    // Just return success with debug info for now
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Debug info retrieved successfully',
      debug: {
        user_id: user.id,
        connection_count: connections.length,
        key_type: keyType,
        private_key_length: privateKey?.length,
        api_identifier: connection.api_identifier_encrypted,
        api_name: connection.api_name_encrypted
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    
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