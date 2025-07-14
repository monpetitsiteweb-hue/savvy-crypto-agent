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
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Authentication required'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's connections
    const { data: connections, error: connectionsError } = await supabase
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (connectionsError || !connections || connections.length === 0) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No active Coinbase connections found'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const connection = connections[0];
    console.log('Processing connection...');

    // Extract API credentials
    const apiIdentifier = connection.api_identifier_encrypted;
    let privateKeyRaw = connection.api_private_key_encrypted;
    const apiName = connection.api_name_encrypted;

    if (!apiIdentifier || !privateKeyRaw) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing API credentials'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse key type and private key
    let keyType = 'ecdsa';
    let privateKey = privateKeyRaw;
    
    if (privateKeyRaw.includes(':')) {
      const parts = privateKeyRaw.split(':', 2);
      keyType = parts[0];
      privateKey = parts[1];
    }

    console.log('Key type:', keyType);

    // Create JWT for Coinbase API
    const timestamp = Math.floor(Date.now() / 1000);
    const requestPath = '/api/v3/brokerage/accounts';
    
    const header = {
      alg: keyType === 'ed25519' ? 'EdDSA' : 'ES256',
      kid: apiIdentifier,
      typ: 'JWT',
      nonce: crypto.randomUUID(),
    };

    const claims = {
      iss: 'cdp',
      nbf: timestamp,
      exp: timestamp + 120,
      sub: keyType === 'ed25519' ? apiIdentifier : apiName,
      uri: 'GET ' + requestPath,
    };

    // Encode header and claims
    const encodedHeader = btoa(JSON.stringify(header)).replace(/[=+/]/g, c => ({
      '=': '', '+': '-', '/': '_'
    })[c]);
    const encodedClaims = btoa(JSON.stringify(claims)).replace(/[=+/]/g, c => ({
      '=': '', '+': '-', '/': '_'
    })[c]);
    const message = encodedHeader + '.' + encodedClaims;

    // Process private key
    let keyData: Uint8Array;
    try {
      const base64Key = privateKey.includes('-----BEGIN') 
        ? privateKey.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')
        : privateKey.trim();
      keyData = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    } catch (e) {
      console.error('Key decode error:', e);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Invalid private key format'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Import and sign with the key
    try {
      let cryptoKey: CryptoKey;
      
      if (keyType === 'ed25519') {
        cryptoKey = await crypto.subtle.importKey(
          'pkcs8', keyData, { name: 'Ed25519' }, false, ['sign']
        );
      } else {
        // Try ECDSA curves
        let imported = false;
        for (const curve of ['P-256', 'P-384', 'P-521']) {
          try {
            cryptoKey = await crypto.subtle.importKey(
              'pkcs8', keyData, { name: 'ECDSA', namedCurve: curve }, false, ['sign']
            );
            imported = true;
            break;
          } catch (e) {
            continue;
          }
        }
        if (!imported) throw new Error('Failed to import ECDSA key');
      }

      // Sign the message
      const messageBytes = new TextEncoder().encode(message);
      const signature = keyType === 'ed25519'
        ? await crypto.subtle.sign('Ed25519', cryptoKey, messageBytes)
        : await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, messageBytes);

      // Create JWT
      const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/[=+/]/g, c => ({ '=': '', '+': '-', '/': '_' })[c]);
      const jwt = message + '.' + encodedSignature;

      console.log('JWT created, calling Coinbase API...');

      // Call Coinbase API
      const response = await fetch('https://api.coinbase.com' + requestPath, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('Coinbase API response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Coinbase API error:', response.status, errorText);
        return new Response(JSON.stringify({ 
          success: false, 
          error: `Coinbase API error: ${response.status}`,
          details: errorText
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await response.json();
      const accounts = data.accounts || [];
      
      console.log('Successfully fetched', accounts.length, 'accounts from Coinbase');

      return new Response(JSON.stringify({ 
        success: true,
        message: 'Real portfolio data fetched from Coinbase',
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

    } catch (cryptoError) {
      console.error('Crypto error:', cryptoError);
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Failed to process API credentials',
        details: cryptoError instanceof Error ? cryptoError.message : 'Crypto error'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Unexpected error:', error);
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