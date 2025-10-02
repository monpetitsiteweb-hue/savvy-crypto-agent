import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const mode = Deno.env.get('SERVER_SIGNER_MODE') || 'local';
    
    // DEV signer config
    const devUrl = Deno.env.get('DEV_SIGNER_WEBHOOK_URL');
    const devAuth = Deno.env.get('DEV_SIGNER_WEBHOOK_AUTH');
    
    // PROD signer config
    const prodUrl = Deno.env.get('SIGNER_WEBHOOK_URL');
    const prodAuth = Deno.env.get('SIGNER_WEBHOOK_AUTH');
    
    // Determine active URL/auth based on mode
    const activeUrl = devUrl || prodUrl;
    const activeAuth = devAuth || prodAuth;
    
    // Value cap
    const maxValueWei = Deno.env.get('MAX_TX_VALUE_WEI');
    
    // RPC URLs
    const rpc8453 = Deno.env.get('RPC_URL_8453');
    
    const response = {
      mode,
      config: {
        hasWebhookUrl: !!activeUrl,
        hasWebhookAuth: !!activeAuth,
        urlSource: devUrl ? 'DEV_SIGNER_WEBHOOK_URL' : prodUrl ? 'SIGNER_WEBHOOK_URL' : 'none',
        authSource: devAuth ? 'DEV_SIGNER_WEBHOOK_AUTH' : prodAuth ? 'SIGNER_WEBHOOK_AUTH' : 'none',
      },
      chains: {
        allowedChainIds: [8453],
        hasRpc8453: !!rpc8453,
      },
      limits: {
        valueCapConfigured: !!maxValueWei,
        valueCapWei: maxValueWei || 'not set',
      },
      warnings: [] as string[],
    };

    // Warnings
    if (mode === 'webhook' && !activeUrl) {
      response.warnings.push('SERVER_SIGNER_MODE=webhook but no webhook URL configured');
    }
    if (mode === 'webhook' && !activeAuth) {
      response.warnings.push('SERVER_SIGNER_MODE=webhook but no webhook auth configured');
    }
    if (!maxValueWei) {
      response.warnings.push('MAX_TX_VALUE_WEI not set - no value cap enforced');
    }
    if (!rpc8453) {
      response.warnings.push('RPC_URL_8453 not set - may use public RPC with rate limits');
    }

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
