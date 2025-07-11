import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
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

    // Get user's Coinbase connection
    const { data: connections, error: connError } = await supabase
      .from('coinbase_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1);

    if (connError || !connections || connections.length === 0) {
      throw new Error('No active Coinbase connection found');
    }

    const connection = connections[0];
    const apiKey = Deno.env.get('COINBASE_API_KEY');
    const apiSecret = Deno.env.get('COINBASE_API_SECRET');

    if (!apiKey || !apiSecret) {
      throw new Error('Coinbase API credentials not configured');
    }

    // Coinbase API endpoint
    const baseUrl = connection.is_sandbox 
      ? 'https://api-public.sandbox.pro.coinbase.com'
      : 'https://api-public.pro.coinbase.com';

    const endpoint = '/accounts';
    const method = 'GET';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = '';

    // Create signature
    const message = timestamp + method + endpoint + body;
    const signature = await generateSignature(message, apiSecret);

    // Make request to Coinbase
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: method,
      headers: {
        'CB-ACCESS-KEY': apiKey,
        'CB-ACCESS-SIGN': signature,
        'CB-ACCESS-TIMESTAMP': timestamp,
        'CB-ACCESS-PASSPHRASE': connection.is_sandbox ? 'sandbox' : 'production',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Coinbase API error:', errorText);
      throw new Error(`Coinbase API error: ${response.status} - ${errorText}`);
    }

    const accounts = await response.json();

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
    console.error('Error in coinbase-portfolio function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});