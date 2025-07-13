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
    console.log('=== Coinbase OAuth Function Called ===');
    
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

    // Get OAuth credentials from admin settings
    const { data: oauthCreds, error: oauthError } = await supabase
      .from('coinbase_oauth_credentials')
      .select('client_id_encrypted, is_sandbox')
      .eq('is_active', true)
      .single();

    if (oauthError || !oauthCreds) {
      console.error('OAuth credentials error:', oauthError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'OAuth app not configured. Please contact administrator.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const clientId = oauthCreds.client_id_encrypted;
    const baseUrl = oauthCreds.is_sandbox 
      ? 'https://www.sandbox.coinbase.com' 
      : 'https://www.coinbase.com';

    // Generate state parameter for security
    const state = crypto.randomUUID();

    // Store state in session/cache for validation (simplified for demo)
    console.log('Generated state:', state);

    // Build OAuth URL
    const scope = 'wallet:accounts:read,wallet:user:read';
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/coinbase-oauth-callback`;
    
    const oauthUrl = new URL(`${baseUrl}/oauth/authorize`);
    oauthUrl.searchParams.set('response_type', 'code');
    oauthUrl.searchParams.set('client_id', clientId);
    oauthUrl.searchParams.set('redirect_uri', redirectUri);
    oauthUrl.searchParams.set('scope', scope);
    oauthUrl.searchParams.set('state', state);

    console.log('Generated OAuth URL:', oauthUrl.toString());

    return new Response(JSON.stringify({ 
      success: true,
      oauth_url: oauthUrl.toString(),
      state: state
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in coinbase-oauth function:', error);
    
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