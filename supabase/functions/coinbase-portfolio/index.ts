
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';
import { SignJWT, importPKCS8 } from 'https://deno.land/x/jose@v4.14.4/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// HMAC-SHA256 signature generation for Coinbase API
async function generateSignature(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== Coinbase Portfolio Function Called ===');
    console.log('Request method:', req.method);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header found');
      throw new Error('No authorization header');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify JWT and get user
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    console.log('Fetching connections for user:', user.id);

    // Get user's Coinbase connection
    const { data: connections, error: connError } = await supabase
      .from('coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1);

    if (connError) {
      console.error('Database error:', connError);
      throw new Error('Database error: ' + connError.message);
    }

    if (!connections || connections.length === 0) {
      throw new Error('No active Coinbase connection found');
    }

    const connection = connections[0];
    console.log('Found connection:', {
      id: connection.id,
      name: connection.connection_name,
      is_sandbox: connection.is_sandbox,
      has_api_key: !!connection.api_key_encrypted,
      has_private_key: !!connection.api_private_key_encrypted
    });

    // Use the stored API credentials from the database
    // Note: For this demo, we'll assume credentials are stored as plain text
    // In production, you'd want to implement proper encryption/decryption
    const apiKey = connection.api_key_encrypted;
    const apiPrivateKey = connection.api_private_key_encrypted;

    if (!apiKey || !apiPrivateKey) {
      console.error('Missing credentials:', { 
        hasKey: !!apiKey, 
        hasPrivateKey: !!apiPrivateKey 
      });
      throw new Error('Coinbase API credentials not found in connection - API Key and Private Key are required');
    }

    console.log('API Key format:', apiKey.substring(0, 50) + '...');
    console.log('Private Key starts with:', apiPrivateKey.substring(0, 30) + '...');
    
    // Validate API key format (should be like "organizations/ORG_ID/apiKeys/KEY_ID")
    if (!apiKey.includes('organizations/') || !apiKey.includes('apiKeys/')) {
      console.error('Invalid API key format. Expected format: organizations/ORG_ID/apiKeys/KEY_ID');
      console.error('Current API key:', apiKey);
      throw new Error('Invalid Coinbase API key format. Please check your API key and update your connection.');
    }
    
    // Validate private key format (should start with -----BEGIN EC PRIVATE KEY-----)
    if (!apiPrivateKey.includes('-----BEGIN') || !apiPrivateKey.includes('PRIVATE KEY-----')) {
      console.error('Invalid private key format. Expected PEM format starting with -----BEGIN EC PRIVATE KEY-----');
      console.error('Private key preview:', apiPrivateKey.substring(0, 100));
      throw new Error('Invalid Coinbase API private key format. Please ensure it\'s in PEM format.');
    }

    // Coinbase Advanced Trade API endpoint
    const baseUrl = connection.is_sandbox 
      ? 'https://api-public.sandbox.coinbase.com'
      : 'https://api.coinbase.com';

    const endpoint = '/api/v3/brokerage/accounts';
    const method = 'GET';
    const timestamp = Math.floor(Date.now() / 1000);

    // Create JWT token for Coinbase Advanced Trade API
    const header = {
      alg: 'ES256',
      kid: apiKey,
      nonce: timestamp.toString()
    };

    const payload = {
      sub: apiKey,
      iss: 'cdp',
      nbf: timestamp,
      exp: timestamp + 120,
      aud: ['retail_rest_api_proxy'],
      uri: method + ' ' + baseUrl + endpoint
    };

    const token = await new SignJWT(payload)
      .setProtectedHeader(header)
      .sign(await importPKCS8(apiPrivateKey, 'ES256'));

    console.log('Making request to:', baseUrl + endpoint);
    console.log('Using sandbox mode:', connection.is_sandbox);

    // Make request to Coinbase Advanced Trade API
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('Coinbase API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Coinbase API error:', errorText);
      throw new Error(`Coinbase API error: ${response.status} - ${errorText}`);
    }

    const accounts = await response.json();
    console.log('Successfully fetched accounts:', accounts.length);

    // Update last sync timestamp
    await supabase
      .from('coinbase_connections')
      .update({ last_sync: new Date().toISOString() })
      .eq('id', connection.id);

    return new Response(JSON.stringify({ 
      success: true,
      accounts: accounts || [],
      connection: {
        name: connection.connection_name,
        is_sandbox: connection.is_sandbox,
        last_sync: new Date().toISOString()
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('=== ERROR in coinbase-portfolio function ===');
    console.error('Error type:', typeof error);
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    console.error('Full error object:', error);
    
    // Determine if this is a validation error (400) or server error (500)
    const isValidationError = error?.message?.includes('Invalid') || 
                             error?.message?.includes('format') ||
                             error?.message?.includes('credentials not found');
    
    const statusCode = isValidationError ? 400 : 500;
    
    return new Response(JSON.stringify({ 
      success: false,
      error: error?.message || 'Unknown error occurred',
      error_type: typeof error,
      error_name: error?.name,
      validation_error: isValidationError
    }), {
      status: statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
