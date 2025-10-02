/**
 * Headless sign & send endpoint
 * Signs a previously built trade and broadcasts it
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { getSigner } from '../_shared/signer.ts';
import { ALLOWED_TO_ADDRESSES } from '../_shared/addresses.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { tradeId } = await req.json();

    if (!tradeId) {
      return new Response(JSON.stringify({ ok: false, error: 'tradeId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SB_URL') ?? Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SB_SERVICE_ROLE') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load trade
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    if (tradeError || !trade) {
      return new Response(JSON.stringify({ ok: false, error: 'Trade not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate trade status
    if (trade.status !== 'built') {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: `Trade status must be 'built', got '${trade.status}'` 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate chain
    if (trade.chain_id !== 8453) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: `Only Base (8453) supported, got chain ${trade.chain_id}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate tx_payload exists
    if (!trade.tx_payload) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Trade missing tx_payload' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Enforce router allowlist with 0x v2 Settler validation
    const targetTo = trade.tx_payload.to.toLowerCase();
    
    if (trade.provider === '0x') {
      // For 0x quotes, validate against the original quote's transaction.to
      // Accept multiple common 0x quote shapes
      const quoteToRaw =
        (trade.raw_quote?.transaction?.to ??
         trade.raw_quote?.to ??
         trade.raw_quote?.tx?.to ??
         trade.raw_quote?.target);

      const quoteTo = typeof quoteToRaw === 'string' ? quoteToRaw.toLowerCase() : undefined;
      
      if (!quoteTo) {
        // Log guard event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'guard',
          severity: 'error',
          payload: {
            error: 'MISSING_QUOTE_TO',
            message: '0x quote missing transaction.to',
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'MISSING_QUOTE_TO',
          message: '0x quote missing transaction.to for validation'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (targetTo !== quoteTo) {
        // Log guard event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'guard',
          severity: 'error',
          payload: {
            error: 'TO_MISMATCH',
            target_to: targetTo,
            quote_to: quoteTo,
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'TO_MISMATCH',
          target_to: trade.tx_payload.to,
          quote_to: trade.raw_quote.transaction.to,
          message: 'tx_payload.to does not match original 0x quote transaction.to'
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // For non-0x providers, use static allowlist
      const toOk = ALLOWED_TO_ADDRESSES.some(a => a.toLowerCase() === targetTo);
      if (!toOk) {
        // Log guard event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'guard',
          severity: 'error',
          payload: {
            error: 'TO_NOT_ALLOWED',
            to: trade.tx_payload.to,
            provider: trade.provider,
          },
        });
        
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'TO_NOT_ALLOWED',
          to: trade.tx_payload.to 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get signer
    const signer = getSigner();
    
    // If local mode, verify taker matches signer address
    if (signer.type === 'local') {
      const botAddress = Deno.env.get('BOT_ADDRESS')!;
      if (trade.taker.toLowerCase() !== botAddress.toLowerCase()) {
        return new Response(JSON.stringify({ 
          ok: false, 
          error: 'TAKER_MISMATCH',
          message: `Local mode requires taker to match BOT_ADDRESS (${botAddress}), got ${trade.taker}` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Sign transaction
    console.log(`🔐 Signing trade ${tradeId} using ${signer.type} signer`);
    let signedTx: string;
    
    try {
      signedTx = await signer.sign(trade.tx_payload, trade.chain_id);
      console.log(`✅ Transaction signed: ${signedTx.slice(0, 20)}...`);
    } catch (signError: any) {
      console.error('❌ Signing failed:', signError);
      
      // Log error event
      await supabase.from('trade_events').insert({
        trade_id: tradeId,
        phase: 'error',
        severity: 'error',
        payload: {
          step: 'sign',
          error: signError.message,
          signer_type: signer.type,
        },
      });

      return new Response(JSON.stringify({ 
        ok: false, 
        error: {
          code: 'SIGNING_FAILED',
          message: signError.message,
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Broadcast transaction
    const rpcUrl = Deno.env.get('RPC_URL_8453')!;
    console.log(`📡 Broadcasting to Base RPC...`);
    
    try {
      const rpcResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_sendRawTransaction',
          params: [signedTx],
        }),
      });

      const rpcResult = await rpcResponse.json();

      if (rpcResult.error) {
        console.error('❌ RPC error:', rpcResult.error);
        
        // Log error event
        await supabase.from('trade_events').insert({
          trade_id: tradeId,
          phase: 'error',
          severity: 'error',
          payload: {
            step: 'broadcast',
            rpc_error: rpcResult.error,
          },
        });

        return new Response(JSON.stringify({ 
          ok: false, 
          error: {
            code: 'BROADCAST_FAILED',
            message: rpcResult.error.message || 'RPC error',
            rpcBody: rpcResult.error,
          }
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const txHash = rpcResult.result;
      console.log(`✅ Transaction broadcast: ${txHash}`);

      // Update trade to submitted
      await supabase
        .from('trades')
        .update({
          status: 'submitted',
          tx_hash: txHash,
          sent_at: new Date().toISOString(),
        })
        .eq('id', tradeId);

      // Log success event
      await supabase.from('trade_events').insert({
        trade_id: tradeId,
        phase: 'submit',
        severity: 'info',
        payload: {
          txHash,
          signer_type: signer.type,
        },
      });

      return new Response(JSON.stringify({ 
        ok: true,
        tradeId,
        tx_hash: txHash,
        network: 'base',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (broadcastError: any) {
      console.error('❌ Broadcast exception:', broadcastError);
      
      // Log error event
      await supabase.from('trade_events').insert({
        trade_id: tradeId,
        phase: 'error',
        severity: 'error',
        payload: {
          step: 'broadcast',
          error: broadcastError.message,
        },
      });

      return new Response(JSON.stringify({ 
        ok: false, 
        error: {
          code: 'BROADCAST_EXCEPTION',
          message: broadcastError.message,
        }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error: any) {
    console.error('❌ Unexpected error:', error);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message,
      }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
