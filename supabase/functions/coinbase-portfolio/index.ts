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
    
    // Accept both GET and POST requests
    if (!['GET', 'POST'].includes(req.method)) {
      console.log('Method not allowed:', req.method);
      return new Response(JSON.stringify({ 
        success: false, 
        error: `Method ${req.method} not allowed. Use GET or POST.` 
      }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Creating Supabase client...');
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    console.log('Getting current user...');
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

    // Get user's connections
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

    // Check if it's an API connection
    const isApiConnection = connection.coinbase_user_id === 'api_user' || 
                           (connection.api_name_encrypted && connection.api_identifier_encrypted && connection.api_private_key_encrypted);

    if (!isApiConnection) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'OAuth connections not supported yet. Please use API credentials.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process API connection
    console.log('Processing API connection...');
    
    const apiName = connection.api_name_encrypted;
    const apiIdentifier = connection.api_identifier_encrypted;
    let privateKeyRaw = connection.api_private_key_encrypted;

    if (!apiIdentifier || !privateKeyRaw) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing API credentials (identifier or private key)' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract key type and private key
    let keyType = 'ecdsa'; // default
    let privateKey = privateKeyRaw;
    
    if (privateKeyRaw && typeof privateKeyRaw === 'string' && 
        (privateKeyRaw.startsWith('ed25519:') || privateKeyRaw.startsWith('ecdsa:'))) {
      const parts = privateKeyRaw.split(':', 2);
      if (parts.length === 2) {
        keyType = parts[0];
        privateKey = parts[1];
        console.log('Detected key type from prefix:', keyType);
      }
    } else {
      console.log('No key type prefix found, assuming ECDSA');
    }

    if (!privateKey || typeof privateKey !== 'string') {
      console.error('Private key is missing or invalid after parsing');
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Private key is missing or invalid' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Key type:', keyType);
    console.log('Private key length:', privateKey.length);

    // Create JWT for Coinbase Advanced Trade API
    const timestamp = Math.floor(Date.now() / 1000);
    const requestPath = '/api/v3/brokerage/accounts';
    
    // Create message for JWT
    const header = {
      alg: keyType === 'ed25519' ? 'EdDSA' : 'ES256',
      kid: apiIdentifier,
      typ: 'JWT',
      nonce: crypto.randomUUID(),
    };

    const claims = {
      iss: 'cdp',
      nbf: timestamp,
      exp: timestamp + 120, // 2 minutes
      sub: keyType === 'ed25519' ? apiIdentifier : apiName,
      uri: 'GET ' + requestPath,
    };

    // Encode header and claims
    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const encodedClaims = btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const message = encodedHeader + '.' + encodedClaims;

    console.log('Created JWT message for signing');

    // Process private key
    let keyData: Uint8Array;
    
    try {
      // Handle both PEM format and direct base64
      let base64Key: string;
      if (privateKey.includes('-----BEGIN')) {
        // PEM format - extract base64 part
        base64Key = privateKey
          .replace(/-----BEGIN [^-]+-----/g, '')
          .replace(/-----END [^-]+-----/g, '')
          .replace(/\s/g, '');
      } else {
        // Already base64 encoded
        base64Key = privateKey.trim();
      }
      
      keyData = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
      console.log('Successfully decoded private key, length:', keyData.length);
    } catch (decodeError) {
      console.error('Failed to decode private key:', decodeError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Invalid private key format - base64 decode failed',
        details: decodeError instanceof Error ? decodeError.message : 'Unknown decode error'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Import cryptographic key
    let cryptoKey: CryptoKey;
    
    try {
      if (keyType === 'ed25519') {
        console.log('Importing Ed25519 key...');
        cryptoKey = await crypto.subtle.importKey(
          'pkcs8',
          keyData,
          { name: 'Ed25519' },
          false,
          ['sign']
        );
        console.log('Successfully imported Ed25519 key');
      } else {
        console.log('Importing ECDSA key...');
        // Try different ECDSA curves
        let imported = false;
        const curves = ['P-256', 'P-384', 'P-521'];
        
        for (const curve of curves) {
          try {
            cryptoKey = await crypto.subtle.importKey(
              'pkcs8',
              keyData,
              { name: 'ECDSA', namedCurve: curve },
              false,
              ['sign']
            );
            console.log(`Successfully imported ECDSA key with curve: ${curve}`);
            imported = true;
            break;
          } catch (curveError) {
            console.log(`Failed to import with curve ${curve}:`, curveError);
          }
        }
        
        if (!imported) {
          throw new Error('Failed to import ECDSA key with any supported curve');
        }
      }
    } catch (importError) {
      console.error('Failed to import private key:', importError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to import private key for signing',
        details: importError instanceof Error ? importError.message : 'Unknown import error'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sign the JWT
    let signature: ArrayBuffer;
    
    try {
      const messageBytes = new TextEncoder().encode(message);
      
      if (keyType === 'ed25519') {
        signature = await crypto.subtle.sign('Ed25519', cryptoKey, messageBytes);
      } else {
        signature = await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          cryptoKey,
          messageBytes
        );
      }
      
      console.log('Successfully signed JWT');
    } catch (signError) {
      console.error('Failed to sign JWT:', signError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to sign JWT',
        details: signError instanceof Error ? signError.message : 'Unknown signing error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create final JWT
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const jwt = message + '.' + encodedSignature;

    console.log('Created complete JWT, calling Coinbase API...');

    // Call Coinbase Advanced Trade API
    let response: Response;
    
    try {
      response = await fetch('https://api.coinbase.com' + requestPath, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('Coinbase API response status:', response.status);
    } catch (fetchError) {
      console.error('Failed to call Coinbase API:', fetchError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to call Coinbase API',
        details: fetchError instanceof Error ? fetchError.message : 'Unknown fetch error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Coinbase API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      
      return new Response(JSON.stringify({ 
        success: false, 
        error: `Coinbase API error: ${response.status} - ${response.statusText}`,
        details: errorText,
        status_code: response.status
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accountsData = await response.json();
    const accounts = accountsData.accounts || [];
    
    console.log('Successfully fetched accounts:', accounts.length);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Portfolio data fetched successfully',
      connection: {
        name: 'Coinbase API Keys',
        is_sandbox: false,
        connected_at: connection.connected_at,
        last_sync: new Date().toISOString(),
        auth_method: 'advanced_trade_api',
        key_type: keyType
      },
      accounts: accounts,
      balances: accounts
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Unexpected error in coinbase-portfolio function:', error);
    
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