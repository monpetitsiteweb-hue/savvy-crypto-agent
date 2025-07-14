
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
    console.log('Request URL:', req.url);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    
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
    // Get current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    console.log('User result:', { user: user?.id, error: userError?.message });

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

    // Get user's connections (both OAuth and API)
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
        error: 'No active Coinbase connections found. Please connect your Coinbase account first.' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const connection = connections[0];
    console.log('Found connection for user:', connection.coinbase_user_id || 'API connection');

    // Determine connection type
    const isApiConnection = connection.coinbase_user_id === 'api_user' || 
                           (connection.api_name_encrypted && connection.api_identifier_encrypted && connection.api_private_key_encrypted);
    const isOAuthConnection = !isApiConnection && connection.coinbase_user_id;

    let response;
    let authMethod;

    if (isApiConnection) {
      // API credentials authentication - Use Coinbase Advanced Trade API
      console.log('Using API credentials authentication with Coinbase Advanced Trade API');
      
      // Check for new format first (api_name_encrypted, etc.)
      if (connection.api_name_encrypted && connection.api_identifier_encrypted && connection.api_private_key_encrypted) {
        const apiName = connection.api_name_encrypted;
        const apiIdentifier = connection.api_identifier_encrypted;
        const privateKey = connection.api_private_key_encrypted;
        
        console.log('Using new API credentials format:', apiName);
        
        try {
          // Create JWT for Coinbase Advanced Trade API
          const timestamp = Math.floor(Date.now() / 1000);
          const method = 'GET';
          const requestPath = '/api/v3/brokerage/accounts';
          
          // JWT header
          const header = {
            alg: 'ES256',
            kid: apiIdentifier,
            nonce: timestamp.toString()
          };
          
          // JWT payload
          const payload = {
            sub: apiName,
            iss: 'coinbase-cloud',
            aud: ['public_websocket_api'],
            exp: timestamp + 120 // 2 minutes
          };
          
          // Encode header and payload
          const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
          const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
          
          const message = encodedHeader + '.' + encodedPayload;
          
          // First try to import the key - handle different formats
          console.log('Attempting to parse private key...');
          console.log('Private key length:', privateKey.length);
          
          let keyData;
          let isEd25519 = false;
          
          // Check if it's Ed25519
          if (privateKey.includes('BEGIN PRIVATE KEY') || privateKey.includes('ED25519')) {
            console.log('Detected possible Ed25519 key');
            isEd25519 = true;
          }
          
          // Clean the PEM key
          let pemKey = privateKey.trim()
            .replace('-----BEGIN EC PRIVATE KEY-----', '')
            .replace('-----END EC PRIVATE KEY-----', '')
            .replace('-----BEGIN PRIVATE KEY-----', '')
            .replace('-----END PRIVATE KEY-----', '')
            .replace(/\s/g, '');
          
          console.log('Cleaned PEM key length:', pemKey.length);
          
          try {
            keyData = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
            console.log('Key data decoded, length:', keyData.length);
          } catch (decodeError) {
            console.error('Failed to decode base64 key:', decodeError);
            throw new Error('Invalid private key format - base64 decode failed');
          }
          
          let cryptoKey = null;
          let usedAlgorithm = null;
          
          // Try Ed25519 first if detected
          if (isEd25519) {
            try {
              cryptoKey = await crypto.subtle.importKey(
                'pkcs8',
                keyData,
                {
                  name: 'Ed25519'
                },
                false,
                ['sign']
              );
              usedAlgorithm = 'Ed25519';
              console.log('Successfully imported Ed25519 key');
            } catch (ed25519Error) {
              console.log('Ed25519 import failed:', ed25519Error.message);
            }
          }
          
          // If not Ed25519 or Ed25519 failed, try ECDSA curves
          if (!cryptoKey) {
            const curves = ['P-256', 'P-384', 'P-521'];
            
            for (const curve of curves) {
              try {
                cryptoKey = await crypto.subtle.importKey(
                  'pkcs8',
                  keyData,
                  {
                    name: 'ECDSA',
                    namedCurve: curve
                  },
                  false,
                  ['sign']
                );
                usedAlgorithm = `ECDSA-${curve}`;
                console.log(`Successfully imported ECDSA key with curve: ${curve}`);
                break;
              } catch (curveError) {
                console.log(`Failed ECDSA import with curve ${curve}:`, curveError.message);
              }
            }
          }
          
          if (!cryptoKey) {
            throw new Error('Failed to import key as Ed25519 or any ECDSA curve');
          }
          
          console.log(`Using algorithm: ${usedAlgorithm}`);
          
          // Create signature based on algorithm
          let signature;
          if (usedAlgorithm === 'Ed25519') {
            signature = await crypto.subtle.sign(
              'Ed25519',
              cryptoKey,
              new TextEncoder().encode(message)
            );
          } else {
            signature = await crypto.subtle.sign(
              {
                name: 'ECDSA',
                hash: 'SHA-256'
              },
              cryptoKey,
              new TextEncoder().encode(message)
            );
          }
          
          const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
            .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
          
          const jwt = message + '.' + encodedSignature;
          
          console.log('JWT created for Advanced Trade API');
          
          // Call Coinbase Advanced Trade API
          response = await fetch('https://api.coinbase.com' + requestPath, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${jwt}`,
              'Content-Type': 'application/json'
            }
          });
          
          authMethod = 'advanced_trade_api';
          
        } catch (jwtError) {
          console.error('JWT creation error:', jwtError);
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'Failed to create JWT for Advanced Trade API',
            details: jwtError instanceof Error ? jwtError.message : 'JWT signing failed',
            connection_type: 'advanced_trade_api'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
      } else if (connection.access_token_encrypted && connection.refresh_token_encrypted) {
        // Legacy format - treat as old API key/secret
        const apiKey = connection.access_token_encrypted;
        const apiSecret = connection.refresh_token_encrypted;
        console.log('Using legacy API key format:', apiKey.substring(0, 10) + '...');

        // For legacy API keys, use Coinbase Wallet API (same as OAuth but with signed requests)
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const method = 'GET';
        const requestPath = '/v2/accounts'; // Wallet API endpoint
        const body = '';
        
        // Create message to sign: timestamp + method + requestPath + body
        const message = timestamp + method + requestPath + body;
        console.log('Signing message for Wallet API:', message);
        
        // Create HMAC signature
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(apiSecret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
        const hexSignature = Array.from(new Uint8Array(signature))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');

        // Use Wallet API base URL (same as OAuth)
        const baseUrl = 'https://api.coinbase.com';
        const fullUrl = baseUrl + requestPath;
        console.log('Calling Coinbase Wallet API with signed request:', fullUrl);
        
        response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            'CB-ACCESS-KEY': apiKey,
            'CB-ACCESS-SIGN': hexSignature,
            'CB-ACCESS-TIMESTAMP': timestamp,
            'CB-VERSION': '2015-07-22',
            'Content-Type': 'application/json',
          },
        });
        
        authMethod = 'wallet_api_signed';
        
      } else {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'API credentials not found for this connection' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
    } else if (isOAuthConnection) {
      // OAuth token authentication
      console.log('Using OAuth token authentication');
      
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
      const requestPath = '/v2/accounts';
      const fullUrl = baseUrl + requestPath;
      console.log('Calling Coinbase OAuth API:', fullUrl);
      
      response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'CB-VERSION': '2023-08-01',
        },
      });
      
      authMethod = 'oauth';
      
    } else {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Invalid connection type. Connection must be either OAuth or API key based.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Coinbase API Response Status:', response.status);
    console.log('Coinbase API Response Headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Coinbase API Error Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: errorText
      });
      
      // Try to parse error details if it's JSON
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = JSON.stringify(errorJson, null, 2);
      } catch (e) {
        // Keep as text if not JSON
      }
      
      return new Response(JSON.stringify({ 
        success: false, 
        error: `Coinbase API error: ${response.status} - ${response.statusText}`,
        details: errorDetails,
        auth_method: authMethod,
        status_code: response.status
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accountsData = await response.json();
    
    // Handle different response formats for OAuth vs API
    let accounts = [];
    if (authMethod === 'oauth') {
      accounts = accountsData.data || [];
      console.log('OAuth accounts fetched:', accounts.length);
    } else {
      accounts = accountsData.accounts || [];
      console.log('API accounts fetched:', accounts.length);
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Portfolio data fetched successfully',
      connection: {
        name: isApiConnection ? 'Coinbase API Keys' : 'Coinbase OAuth',
        is_sandbox: false,
        connected_at: connection.connected_at,
        last_sync: new Date().toISOString(),
        auth_method: authMethod
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
