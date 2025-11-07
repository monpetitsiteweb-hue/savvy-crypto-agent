import { BASE_CHAIN_ID, BASE_TOKENS, BASE_DECIMALS, formatTokenAmount } from '../_shared/addresses.ts';
import { simulateCall } from '../_shared/eth.ts';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SimulateSwapRequest {
  from: string;
  side: 'BUY' | 'SELL';
  baseToken: string; // e.g., 'ETH' or 'WETH'
  quoteToken: string; // e.g., 'USDC'
  amount: string; // in base token for SELL, in quote token for BUY
  slippageBps: number;
  backend?: 'anvil' | 'tenderly';
  maxSimMs?: number;
}

interface SimulateSwapResponse {
  success: boolean;
  backend: string;
  side: string;
  slippageBps: number;
  expectedGas?: string;
  expectedOut?: string;
  route?: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    buyAmount: string;
    estimatedGas: string;
  };
  simulationResult?: string;
  error?: string;
  timestamp: number;
  determinismHash?: string;
}

async function fetch0xQuote(
  chainId: number,
  sellToken: string,
  buyToken: string,
  sellAmount: string,
  slippageBps: number,
  takerAddress: string
): Promise<any> {
  const apiKey = Deno.env.get('ZEROEX_API_KEY');
  if (!apiKey) {
    throw new Error('ZEROEX_API_KEY not configured');
  }

  const slippageDecimal = slippageBps / 10000;
  const url = `https://api.0x.org/swap/v1/quote?chainId=${chainId}&sellToken=${sellToken}&buyToken=${buyToken}&sellAmount=${sellAmount}&slippagePercentage=${slippageDecimal}&takerAddress=${takerAddress}`;

  logger.info('[sim.swap.route.start]', { sellToken, buyToken, sellAmount, slippageBps });

  const response = await fetch(url, {
    headers: {
      '0x-api-key': apiKey,
      '0x-version': 'v2',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`0x API error: ${response.status} - ${errorText}`);
  }

  const quote = await response.json();
  logger.info('[sim.swap.route.done]', { 
    buyAmount: quote.buyAmount,
    gas: quote.estimatedGas,
  });

  return quote;
}

function resolveTokenAddress(symbol: string): string {
  const normalized = symbol.toUpperCase();
  if (normalized === 'ETH' || normalized === 'WETH') {
    return BASE_TOKENS.WETH;
  }
  if (normalized === 'USDC') {
    return BASE_TOKENS.USDC;
  }
  // Check if it's already an address
  if (/^0x[a-fA-F0-9]{40}$/.test(symbol)) {
    return symbol;
  }
  throw new Error(`Unknown token symbol: ${symbol}`);
}

function getTokenDecimals(address: string): number {
  if (address.toLowerCase() === BASE_TOKENS.WETH.toLowerCase()) {
    return BASE_DECIMALS.WETH;
  }
  if (address.toLowerCase() === BASE_TOKENS.USDC.toLowerCase()) {
    return BASE_DECIMALS.USDC;
  }
  throw new Error(`Unknown token decimals for address: ${address}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTs = Date.now();
  logger.info('[sim.swap.start]');

  try {
    const body: SimulateSwapRequest = await req.json();
    const { 
      from, 
      side, 
      baseToken, 
      quoteToken, 
      amount, 
      slippageBps,
      backend = 'anvil',
      maxSimMs = 30000 
    } = body;

    // Validate inputs
    if (!from || !/^0x[a-fA-F0-9]{40}$/.test(from)) {
      throw new Error('Invalid from address');
    }
    if (side !== 'BUY' && side !== 'SELL') {
      throw new Error('Invalid side (must be BUY or SELL)');
    }
    if (slippageBps < 0 || slippageBps > 10000) {
      throw new Error('Invalid slippageBps (must be 0-10000)');
    }

    const amountBigInt = BigInt(amount);
    if (amountBigInt <= 0n) {
      throw new Error('Amount must be positive');
    }

    // Resolve token addresses
    const baseTokenAddr = resolveTokenAddress(baseToken);
    const quoteTokenAddr = resolveTokenAddress(quoteToken);
    const baseDecimals = getTokenDecimals(baseTokenAddr);
    const quoteDecimals = getTokenDecimals(quoteTokenAddr);

    // Determine sell/buy tokens based on side
    let sellToken: string;
    let buyToken: string;
    let sellAmount: string;

    if (side === 'SELL') {
      // SELL base token, BUY quote token
      sellToken = baseTokenAddr;
      buyToken = quoteTokenAddr;
      sellAmount = amount;
    } else {
      // BUY base token (sell quote token)
      sellToken = quoteTokenAddr;
      buyToken = baseTokenAddr;
      sellAmount = amount;
    }

    // Detect simulation backend
    const simBackend = Deno.env.get('SIM_BACKEND') || backend;
    
    if (simBackend === 'tenderly') {
      const tenderlyKey = Deno.env.get('TENDERLY_API_KEY');
      if (!tenderlyKey) {
        logger.warn('[sim.swap] Tenderly selected but no API key, falling back to Anvil');
      }
    }

    // Fetch 0x v2 route
    const quote = await fetch0xQuote(
      BASE_CHAIN_ID,
      sellToken,
      buyToken,
      sellAmount,
      slippageBps,
      from
    );

    // Extract transaction data from quote
    const { to, data, value = '0x0', gas } = quote.transaction || quote;
    if (!to || !data) {
      throw new Error('Invalid quote response: missing transaction data');
    }

    // Build transaction for simulation
    const txRequest = {
      to,
      from,
      data,
      value,
      gas: '0x' + BigInt(gas || 500000).toString(16),
    };

    logger.info('[sim.swap.call.start]', {
      backend: simBackend,
      side,
      slippageBps,
      sellToken: formatTokenAmount(BigInt(sellAmount), side === 'SELL' ? baseDecimals : quoteDecimals),
      expectedOut: formatTokenAmount(BigInt(quote.buyAmount), side === 'SELL' ? quoteDecimals : baseDecimals),
    });

    // Execute eth_call simulation with timeout
    const simPromise = simulateCall(BASE_CHAIN_ID, txRequest);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Simulation timeout')), maxSimMs)
    );

    const simResult = await Promise.race([simPromise, timeoutPromise]) as Awaited<ReturnType<typeof simulateCall>>;

    if (!simResult.success) {
      logger.error('[sim.swap.call.failed]', { error: simResult.error });
      const response: SimulateSwapResponse = {
        success: false,
        backend: simBackend,
        side,
        slippageBps,
        error: simResult.error || 'Simulation failed',
        timestamp: Date.now(),
      };
      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // Generate determinism hash from quote data
    const deterministicData = JSON.stringify({
      sellToken,
      buyToken,
      sellAmount,
      slippageBps,
      chainId: BASE_CHAIN_ID,
    });
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(deterministicData));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const determinismHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    logger.info('[sim.swap.done]', {
      backend: simBackend,
      side,
      slippageBps,
      expectedGas: gas || '500000',
      expectedOut: quote.buyAmount,
      duration: Date.now() - startTs,
      determinismHash,
    });

    const response: SimulateSwapResponse = {
      success: true,
      backend: simBackend,
      side,
      slippageBps,
      expectedGas: (gas || '500000').toString(),
      expectedOut: quote.buyAmount,
      route: {
        sellToken,
        buyToken,
        sellAmount,
        buyAmount: quote.buyAmount,
        estimatedGas: (gas || '500000').toString(),
      },
      simulationResult: simResult.result,
      timestamp: Date.now(),
      determinismHash,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    logger.error('[sim.error]', {
      code: 'SWAP_SIMULATION_ERROR',
      message: error.message,
      duration: Date.now() - startTs,
    });

    const response: SimulateSwapResponse = {
      success: false,
      backend: 'unknown',
      side: 'SELL',
      slippageBps: 0,
      error: error.message || 'Unknown error',
      timestamp: Date.now(),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
