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
    
    // Debug: Log headers
    const authHeader = req.headers.get('Authorization');
    console.log('Authorization header received:', authHeader ? 'present' : 'missing');
    console.log('All headers:', Object.fromEntries(req.headers.entries()));
    
    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader || '' },
        },
      }
    );

    console.log('Attempting to get user from token...');
    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    console.log('User resolution result:', {
      hasUser: !!user,
      userId: user?.id,
      userError: userError?.message,
      userErrorCode: userError?.status
    });

    if (userError || !user) {
      console.error('Authentication failed:', {
        error: userError,
        hasAuthHeader: !!authHeader,
        authHeaderLength: authHeader?.length
      });
      
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Authentication required',
        debug: {
          hasAuthHeader: !!authHeader,
          errorMessage: userError?.message,
          errorStatus: userError?.status
        }
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('User authenticated:', user.id);

    // Test database access first with a simple query
    console.log('Testing basic database access...');
    try {
      const { data: testData, error: testError } = await supabase
        .rpc('get_active_oauth_credentials');
      
      console.log('OAuth credentials function result:', {
        hasData: !!testData && testData.length > 0,
        dataCount: testData?.length || 0,
        error: testError?.message,
        errorCode: testError?.code
      });

      if (testError || !testData || testData.length === 0) {
        console.error('OAuth credentials not found or error:', testError);
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'OAuth app not configured. Please contact administrator.',
          debug: {
            errorMessage: testError?.message,
            errorCode: testError?.code,
            hasData: !!testData,
            dataLength: testData?.length || 0
          }
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const oauthCreds = testData[0];
      console.log('OAuth credentials retrieved successfully:', {
        hasClientId: !!oauthCreds.client_id_encrypted,
        isSandbox: oauthCreds.is_sandbox
      });

    } catch (dbTestError) {
      console.error('Database access failed:', dbTestError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Database access failed',
        debug: {
          errorMessage: dbTestError instanceof Error ? dbTestError.message : 'Unknown error'
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get OAuth credentials using the security definer function
    console.log('Fetching OAuth credentials via RPC...');
    const { data: oauthCredsArray, error: oauthError } = await supabase
      .rpc('get_active_oauth_credentials');

    if (oauthError || !oauthCredsArray || oauthCredsArray.length === 0) {
      console.error('OAuth credentials RPC error:', oauthError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'OAuth app not configured. Please contact administrator.',
        debug: {
          errorMessage: oauthError?.message,
          errorCode: oauthError?.code,
          hasArray: !!oauthCredsArray,
          arrayLength: oauthCredsArray?.length || 0
        }
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const oauthCreds = oauthCredsArray[0];

    const clientId = oauthCreds.client_id_encrypted;
    // Always use production URL for OAuth authorization, even in sandbox mode
    const baseUrl = 'https://www.coinbase.com';

    // Generate state parameter with user ID for security
    const state = `${user.id}_${crypto.randomUUID()}`;

    // Store state for validation (simplified for demo)
    console.log('Generated state with user ID:', state);

    // Build OAuth URL
    const scope = 'wallet:accounts:read,wallet:user:read';
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/oauth-callback`;
    
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