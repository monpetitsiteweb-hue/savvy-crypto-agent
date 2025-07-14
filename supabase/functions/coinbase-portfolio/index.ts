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
    console.log('Starting function...');
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    console.log('Getting user...');
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      console.log('Auth failed:', userError?.message);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Authentication failed',
        step: 'auth'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('User OK, getting connections...');
    const { data: connections, error: dbError } = await supabase
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (dbError) {
      console.log('DB error:', dbError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Database error: ' + dbError.message,
        step: 'database'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!connections || connections.length === 0) {
      console.log('No connections found');
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No connections found',
        step: 'no_connections'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Found connection, testing crypto...');
    
    // Test basic crypto functionality
    try {
      const testMessage = "test";
      const testKey = await crypto.subtle.generateKey(
        { name: "Ed25519" },
        false,
        ["sign"]
      );
      const signature = await crypto.subtle.sign(
        "Ed25519",
        testKey,
        new TextEncoder().encode(testMessage)
      );
      console.log('Crypto test passed, signature length:', signature.byteLength);
    } catch (cryptoError) {
      console.log('Crypto test failed:', cryptoError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Crypto not supported: ' + cryptoError.message,
        step: 'crypto_test'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const connection = connections[0];
    console.log('Connection data check...');
    console.log('Has api_identifier:', !!connection.api_identifier_encrypted);
    console.log('Has private_key:', !!connection.api_private_key_encrypted);
    console.log('Private key preview:', connection.api_private_key_encrypted?.substring(0, 20) + '...');

    return new Response(JSON.stringify({ 
      success: true,
      message: 'All basic tests passed',
      debug: {
        user_id: user.id,
        connection_id: connection.id,
        has_api_identifier: !!connection.api_identifier_encrypted,
        has_private_key: !!connection.api_private_key_encrypted,
        private_key_preview: connection.api_private_key_encrypted?.substring(0, 20) + '...',
        step: 'success'
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Function error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Function failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
      step: 'function_error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});