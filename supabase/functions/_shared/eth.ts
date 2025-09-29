/**
 * Shared Ethereum utilities for on-chain execution
 */

const RPC_URLS: Record<number, string> = {
  1: Deno.env.get('RPC_URL_1') || 'https://eth.llamarpc.com',
  8453: Deno.env.get('RPC_URL_8453') || 'https://base.llamarpc.com',
  42161: Deno.env.get('RPC_URL_42161') || 'https://arbitrum.llamarpc.com',
};

export interface TxRequest {
  to: string;
  from: string;
  data: string;
  value?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

/**
 * Simulate a transaction using eth_call
 */
export async function simulateCall(
  chainId: number,
  txRequest: TxRequest,
  blockTag: string = 'latest'
): Promise<{ success: boolean; result?: string; error?: string }> {
  const rpcUrl = RPC_URLS[chainId];
  if (!rpcUrl) {
    return { success: false, error: `No RPC URL for chainId ${chainId}` };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: txRequest.to,
            from: txRequest.from,
            data: txRequest.data,
            value: txRequest.value || '0x0',
            gas: txRequest.gas,
          },
          blockTag,
        ],
        id: 1,
      }),
    });

    const json = await response.json();
    
    if (json.error) {
      return { success: false, error: json.error.message || JSON.stringify(json.error) };
    }

    return { success: true, result: json.result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Send a raw signed transaction
 * Note: This requires the transaction to be already signed by the client
 */
export async function sendRawTransaction(
  chainId: number,
  signedTx: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rpcUrl = RPC_URLS[chainId];
  if (!rpcUrl) {
    return { success: false, error: `No RPC URL for chainId ${chainId}` };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_sendRawTransaction',
        params: [signedTx],
        id: 1,
      }),
    });

    const json = await response.json();
    
    if (json.error) {
      return { success: false, error: json.error.message || JSON.stringify(json.error) };
    }

    return { success: true, txHash: json.result };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Wait for transaction receipt (with polling)
 */
export async function waitForReceipt(
  chainId: number,
  txHash: string,
  maxAttempts = 30,
  intervalMs = 2000
): Promise<{ success: boolean; receipt?: any; error?: string }> {
  const rpcUrl = RPC_URLS[chainId];
  if (!rpcUrl) {
    return { success: false, error: `No RPC URL for chainId ${chainId}` };
  }

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [txHash],
          id: 1,
        }),
      });

      const json = await response.json();
      
      if (json.error) {
        return { success: false, error: json.error.message || JSON.stringify(json.error) };
      }

      if (json.result) {
        // Receipt found
        const status = json.result.status;
        const success = status === '0x1' || status === 1;
        return { success, receipt: json.result };
      }

      // Receipt not found yet, wait and retry
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  return { success: false, error: 'Timeout waiting for receipt' };
}

/**
 * Get nonce for address
 */
export async function getNonce(
  chainId: number,
  address: string,
  blockTag: string = 'latest'
): Promise<{ nonce?: number; error?: string }> {
  const rpcUrl = RPC_URLS[chainId];
  if (!rpcUrl) {
    return { error: `No RPC URL for chainId ${chainId}` };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionCount',
        params: [address, blockTag],
        id: 1,
      }),
    });

    const json = await response.json();
    
    if (json.error) {
      return { error: json.error.message || JSON.stringify(json.error) };
    }

    return { nonce: parseInt(json.result, 16) };
  } catch (error) {
    return { error: String(error) };
  }
}

/**
 * Convert transaction to EIP-1559 format
 */
export function toEip1559(txRequest: TxRequest, maxFeePerGas: string, maxPriorityFeePerGas: string): TxRequest {
  const { gasPrice, ...rest } = txRequest;
  return {
    ...rest,
    maxFeePerGas,
    maxPriorityFeePerGas,
  };
}

/**
 * Calculate minimum output from guaranteed price
 * guaranteedPrice is the price the swap will get or better
 * For SELL: minOut = sellAmount * guaranteedPrice
 * For BUY: minOut = already in the quote response
 */
export function calcMinOutFromGuaranteedPrice(
  side: 'SELL' | 'BUY',
  amountAtomic: bigint,
  guaranteedPriceAtomicRatio: number
): bigint {
  if (side === 'SELL') {
    // guaranteedPrice = buyAmount / sellAmount
    // minOut = sellAmount * guaranteedPrice
    return BigInt(Math.floor(Number(amountAtomic) * guaranteedPriceAtomicRatio));
  } else {
    // For BUY, the guaranteed price is already the minimum we'll get
    return amountAtomic;
  }
}
