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

    // Parse request body to get connection ID
    let requestBody = {};
    try {
      if (req.method === 'POST') {
        requestBody = await req.json();
      }
    } catch (error) {
      console.log('No request body or invalid JSON');
    }

    const requestedConnectionId = (requestBody as any)?.connectionId;
    console.log('Requested connection ID:', requestedConnectionId);

    // Get user's active Coinbase connections
    let query = supabaseClient
      .from('user_coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    // If specific connection requested, filter by it
    if (requestedConnectionId) {
      query = query.eq('id', requestedConnectionId);
    }

    const { data: connections, error: connectionError } = await query;

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
      // OAuth connection - implement token refresh logic
      console.log('🔐 Using OAuth connection, ID:', connection.id);
      
      // Check if token is expired
      const now = new Date();
      const expiresAt = new Date(connection.expires_at);
      const isExpired = now >= expiresAt;
      
      console.log('⏰ Token expiry check:', {
        now: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        isExpired: isExpired,
        timeUntilExpiry: expiresAt.getTime() - now.getTime() + 'ms'
      });
      
      let accessToken = connection.access_token_encrypted;
      
      if (isExpired) {
        console.log('Access token expired, attempting refresh...');
        
        if (!connection.refresh_token_encrypted) {
          console.error('No refresh token available');
          return new Response(JSON.stringify({ 
            error: 'Authentication expired',
            message: 'Please reconnect your Coinbase account',
            needsReconnection: true
          }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        try {
          // Get OAuth credentials
          const { data: oauthCredsArray } = await supabaseClient
            .rpc('get_active_oauth_credentials');
          
          if (!oauthCredsArray || oauthCredsArray.length === 0) {
            throw new Error('OAuth credentials not configured');
          }
          
          const oauthCreds = oauthCredsArray[0];
          const clientId = oauthCreds.client_id_encrypted;
          
          // Get client secret from Supabase secrets
          const clientSecret = Deno.env.get('COINBASE_CLIENT_SECRET');
          if (!clientSecret) {
            throw new Error('COINBASE_CLIENT_SECRET not configured');
          }
          
          // Refresh the token
          const refreshResponse = await fetch('https://api.coinbase.com/oauth/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: connection.refresh_token_encrypted,
              client_id: clientId,
              client_secret: clientSecret,
            }),
          });
          
          if (!refreshResponse.ok) {
            const errorData = await refreshResponse.text();
            console.error('Token refresh failed:', errorData);
            throw new Error(`Token refresh failed: ${refreshResponse.status}`);
          }
          
          const tokenData = await refreshResponse.json();
          console.log('Token refresh successful');
          
          // Update the connection with new tokens
          const newExpiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
          
          const { error: updateError } = await supabaseClient
            .from('user_coinbase_connections')
            .update({
              access_token_encrypted: tokenData.access_token,
              refresh_token_encrypted: tokenData.refresh_token || connection.refresh_token_encrypted,
              expires_at: newExpiresAt.toISOString(),
              last_sync: new Date().toISOString()
            })
            .eq('id', connection.id);
          
          if (updateError) {
            console.error('Failed to update connection:', updateError);
            throw new Error('Failed to save new tokens');
          }
          
          accessToken = tokenData.access_token;
          console.log('Token refreshed and saved successfully');
          
        } catch (refreshError) {
          console.error('Token refresh error:', refreshError);
          return new Response(JSON.stringify({ 
            error: 'Failed to refresh authentication',
            message: 'Please reconnect your Coinbase account',
            needsReconnection: true,
            details: refreshError instanceof Error ? refreshError.message : 'Unknown error'
          }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      
      // Now make the actual API call with valid token
      try {
        console.log('🚀 Making OAuth API call to Coinbase');
        
        const coinbaseResponse = await fetch('https://api.coinbase.com/v2/accounts', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        
        console.log('📡 Coinbase OAuth API response:', {
          status: coinbaseResponse.status,
          statusText: coinbaseResponse.statusText,
          headers: Object.fromEntries(coinbaseResponse.headers.entries())
        });
        
        if (!coinbaseResponse.ok) {
          const errorData = await coinbaseResponse.text();
          console.error('❌ Coinbase OAuth API error:', errorData);
          
          // Check for authentication errors specifically
          if (coinbaseResponse.status === 401) {
            return new Response(JSON.stringify({ 
              error: 'OAuth authentication failed',
              message: 'Your Coinbase connection has expired. Please reconnect.',
              needsReconnection: true,
              details: errorData,
              connectionType: 'oauth'
            }), {
              status: 401,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          throw new Error(`Coinbase API error: ${coinbaseResponse.status} - ${errorData}`);
        }
        
        const portfolioData = await coinbaseResponse.json();
        console.log('✅ Successfully fetched OAuth portfolio data:', {
          accountCount: portfolioData.data?.length || 0,
          tokenRefreshed: isExpired
        });
        
        return new Response(JSON.stringify({ 
          success: true,
          message: `Successfully fetched ${portfolioData.data?.length || 0} accounts from Coinbase`,
          accounts: portfolioData.data,
          connectionType: 'oauth',
          connectionId: connection.id,
          tokenWasRefreshed: isExpired
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
        
      } catch (apiError) {
        console.error('❌ Coinbase OAuth API call failed:', apiError);
        return new Response(JSON.stringify({ 
          error: 'Failed to fetch portfolio via OAuth',
          details: apiError instanceof Error ? apiError.message : 'Unknown error',
          connectionType: 'oauth',
          needsReconnection: false
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else if (connection.api_identifier_encrypted && connection.api_private_key_encrypted) {
      // API key connection - check if it's Ed25519 or ECDSA
      console.log('Using API key connection');
      
      const apiKey = connection.api_identifier_encrypted;
      const privateKeyData = connection.api_private_key_encrypted;
      
      // Check if it's Ed25519 key (new Coinbase Advanced Trading API)
      if (privateKeyData.startsWith('ed25519:')) {
        console.log('Processing Ed25519 key for Coinbase Advanced Trading API');
        
        // Extract the base64 private key (remove "ed25519:" prefix)
        const base64PrivateKey = privateKeyData.slice(8); // Remove "ed25519:" (8 chars)
        console.log('Base64 key extracted, length:', base64PrivateKey.length);
        
         // Create JWT for Coinbase Advanced Trading API
         const timestamp = Math.floor(Date.now() / 1000);
         
         // Generate a proper nonce (UUID format)
         const nonce = crypto.randomUUID();
         
         const header = {
           alg: "EdDSA",
           typ: "JWT", 
           kid: apiKey,
           nonce: nonce
         };
        
          const payload = {
            sub: apiKey,
            iss: "cdp",
            nbf: timestamp,
            exp: timestamp + 120, // 2 minutes
            aud: ["retail_rest_api_proxy"],
            uri: "GET api.coinbase.com/api/v3/brokerage/accounts"
          };
        
        // Base64URL encode (without padding)
        const encodeBase64URL = (obj) => {
          return btoa(JSON.stringify(obj))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
        };
        
        const encodedHeader = encodeBase64URL(header);
        const encodedPayload = encodeBase64URL(payload);
        const message = `${encodedHeader}.${encodedPayload}`;
        
        try {
          // Use noble Ed25519 library with SHA-512 setup
          const ed25519Module = await import('https://esm.sh/@noble/ed25519@2.0.0');
          const { sha512 } = await import('https://esm.sh/@noble/hashes@1.3.3/sha512');
          
          // Set up SHA-512 for noble/ed25519
          ed25519Module.etc.sha512Sync = (...m) => sha512(ed25519Module.etc.concatBytes(...m));
          
          // Now we can use the sign function
          const { sign } = ed25519Module;
          
          // Decode the Ed25519 private key from base64
          const privateKeyBytes = Uint8Array.from(atob(base64PrivateKey), c => c.charCodeAt(0));
          console.log('Private key bytes length:', privateKeyBytes.length);
          
          // Ed25519 private keys should be 32 bytes, but we got 64 (private + public)
          // Take only the first 32 bytes for the private key
          const privateKey = privateKeyBytes.slice(0, 32);
          console.log('Using private key length:', privateKey.length);
          
          // Create message to sign
          const messageBytes = new TextEncoder().encode(message);
          console.log('Message to sign length:', messageBytes.length);
          
           // Sign with Ed25519 using noble library
           const signatureBytes = await sign(messageBytes, privateKey);
           console.log('Signature created, length:', signatureBytes.length);
          
          // Encode signature as base64URL
          const signature = btoa(String.fromCharCode(...signatureBytes))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '');
          
          const jwt = `${message}.${signature}`;
          console.log('JWT created successfully, length:', jwt.length);
          
          // Make API call to Coinbase Advanced Trading API (must match JWT URI exactly)
          const response = await fetch('https://api.coinbase.com/api/v3/brokerage/accounts', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${jwt}`,
              'Content-Type': 'application/json',
            },
          });
          
          console.log('Coinbase API response status:', response.status);
          console.log('Coinbase API response headers:', Object.fromEntries(response.headers.entries()));
          
          // Handle response based on content type
          let result;
          const contentType = response.headers.get('content-type');
          
          if (contentType && contentType.includes('application/json')) {
            result = await response.json();
          } else {
            // Handle non-JSON responses (like plain text error messages)
            const textResult = await response.text();
            console.log('Coinbase API text response:', textResult);
            result = { message: textResult, status: response.status };
          }
          
          console.log('Coinbase API response:', result);
          
          if (!response.ok) {
            return new Response(JSON.stringify({ 
              error: 'Coinbase API request failed',
              status: response.status,
              details: result,
              jwt_preview: jwt.substring(0, 100) + '...',
              contentType: contentType
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          return new Response(JSON.stringify({ 
            success: true,
            message: `Successfully fetched ${result.accounts?.length || 0} accounts from Coinbase`,
            accounts: result.accounts,
            connectionType: 'ed25519'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
          
        } catch (error) {
          console.error('Ed25519 signing error:', error);
          return new Response(JSON.stringify({ 
            error: 'Failed to sign JWT with Ed25519 key',
            details: error instanceof Error ? error.message : 'Unknown error',
            errorName: error instanceof Error ? error.name : 'Unknown'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
      } else {
        // Legacy ECDSA key (old Coinbase Pro API)
        console.log('Detected ECDSA key - using legacy Pro API');
        
        const apiSecret = privateKeyData;
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const method = 'GET';
        const requestPath = '/v2/accounts';
        
        // Create signature for legacy Coinbase API
        const message = timestamp + method + requestPath;
        
        try {
          // Import crypto for HMAC
          const crypto = await import('node:crypto');
          const signature = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
          
          // Make request to legacy Coinbase API
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
          console.log('Legacy Coinbase API response status:', coinbaseResponse.status);
          
          if (!coinbaseResponse.ok) {
            console.error('Legacy Coinbase API error:', portfolioData);
            return new Response(JSON.stringify({ 
              error: 'Failed to fetch portfolio from legacy Coinbase API',
              details: portfolioData.errors || portfolioData.message || 'API request failed',
              status: coinbaseResponse.status,
              keyType: 'ecdsa'
            }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          
          return new Response(JSON.stringify({ 
            success: true,
            message: `Successfully fetched ${portfolioData.data?.length || 0} accounts from legacy Coinbase API`,
            data: portfolioData.data,
            connectionType: 'api_key',
            keyType: 'ecdsa',
            connectionId: connection.id
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
          
        } catch (apiError) {
          console.error('Legacy Coinbase API error:', apiError);
          return new Response(JSON.stringify({ 
            error: 'Failed to fetch portfolio from legacy Coinbase API',
            details: apiError instanceof Error ? apiError.message : 'Unknown error',
            keyType: 'ecdsa'
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
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