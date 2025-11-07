import { BASE_CHAIN_ID, BASE_TOKENS, formatTokenAmount } from '../_shared/addresses.ts';
import { simulateCall } from '../_shared/eth.ts';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SimulateWrapRequest {
  address: string;
  amountWei: string;
  backend?: 'anvil' | 'tenderly';
  maxSimMs?: number;
}

interface SimulateWrapResponse {
  success: boolean;
  backend: string;
  expectedGas?: string;
  simulationResult?: string;
  error?: string;
  timestamp: number;
}

// WETH deposit() function signature
const WETH_DEPOSIT_CALLDATA = '0xd0e30db0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTs = Date.now();
  logger.info('[sim.wrap.start]');

  try {
    const body: SimulateWrapRequest = await req.json();
    const { address, amountWei, backend = 'anvil', maxSimMs = 30000 } = body;

    // Validate inputs
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error('Invalid address format');
    }

    const amount = BigInt(amountWei);
    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }

    // Detect simulation backend
    const simBackend = Deno.env.get('SIM_BACKEND') || backend;
    
    if (simBackend === 'tenderly') {
      const tenderlyKey = Deno.env.get('TENDERLY_API_KEY');
      if (!tenderlyKey) {
        logger.warn('[sim.wrap] Tenderly selected but no API key, falling back to Anvil');
      }
    }

    logger.info('[sim.wrap] Using backend:', simBackend);

    // Build WETH wrap transaction
    const txRequest = {
      to: BASE_TOKENS.WETH,
      from: address,
      data: WETH_DEPOSIT_CALLDATA,
      value: '0x' + amount.toString(16),
      gas: '0x' + (100000n).toString(16), // 100k gas estimate for deposit
    };

    logger.info('[sim.wrap.call.start]', {
      backend: simBackend,
      amount: formatTokenAmount(amount, 18),
      to: BASE_TOKENS.WETH,
    });

    // Execute eth_call simulation with timeout
    const simPromise = simulateCall(BASE_CHAIN_ID, txRequest);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Simulation timeout')), maxSimMs)
    );

    const simResult = await Promise.race([simPromise, timeoutPromise]) as Awaited<ReturnType<typeof simulateCall>>;

    if (!simResult.success) {
      logger.error('[sim.wrap.call.failed]', { error: simResult.error });
      const response: SimulateWrapResponse = {
        success: false,
        backend: simBackend,
        error: simResult.error || 'Simulation failed',
        timestamp: Date.now(),
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    logger.info('[sim.wrap.done]', {
      backend: simBackend,
      expectedGas: '100000',
      duration: Date.now() - startTs,
    });

    const response: SimulateWrapResponse = {
      success: true,
      backend: simBackend,
      expectedGas: '100000',
      simulationResult: simResult.result,
      timestamp: Date.now(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    logger.error('[sim.error]', {
      code: 'WRAP_SIMULATION_ERROR',
      message: error.message,
      duration: Date.now() - startTs,
    });

    const response: SimulateWrapResponse = {
      success: false,
      backend: 'unknown',
      error: error.message || 'Unknown error',
      timestamp: Date.now(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
