import { corsHeaders, withCors } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const mode = Deno.env.get('SERVER_SIGNER_MODE') || 'unset';
    
    // Check webhook config
    const devUrl = Deno.env.get('DEV_SIGNER_WEBHOOK_URL');
    const devAuth = Deno.env.get('DEV_SIGNER_WEBHOOK_AUTH');
    const prodUrl = Deno.env.get('SIGNER_WEBHOOK_URL');
    const prodAuth = Deno.env.get('SIGNER_WEBHOOK_AUTH');
    
    const activeUrl = devUrl || prodUrl;
    const activeAuth = devAuth || prodAuth;
    
    // Check local key (not actually used yet, but kept for future)
    const localKey = Deno.env.get('BOT_PRIVATE_KEY');
    
    // Bot address (if we can derive it - for now just null)
    const botAddress = null; // Would need to derive from key or webhook
    
    const response = {
      ok: true,
      mode,
      hasWebhookUrl: !!activeUrl,
      hasWebhookAuth: !!activeAuth,
      hasLocalKey: !!localKey,
      botAddress,
    };

    return new Response(JSON.stringify(response, null, 2), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Signer debug error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error', message: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
