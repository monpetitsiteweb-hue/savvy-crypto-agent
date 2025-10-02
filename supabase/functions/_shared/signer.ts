/**
 * Signer abstraction for headless trade execution
 * Supports webhook-based signing (production) and local signing (dev only)
 */

import { parseEther, parseUnits } from 'npm:viem@2.x';
import { privateKeyToAccount } from 'npm:viem@2.x/accounts';
import { base } from 'npm:viem@2.x/chains';

const ALLOWED_CHAIN_IDS = [8453]; // Base only
const MAX_TX_VALUE_WEI = BigInt(Deno.env.get('MAX_TX_VALUE_WEI') || '100000000000000000000'); // 100 ETH default

export interface TxPayload {
  to: string;
  data: string;
  value: string;
  gas: string;
  from: string;
}

export interface Signer {
  type: 'webhook' | 'local';
  sign(txPayload: TxPayload, chainId: number): Promise<string>;
}

/**
 * Webhook signer: delegates signing to external service
 */
class WebhookSigner implements Signer {
  type: 'webhook' = 'webhook';
  private url: string;
  private authToken: string;

  constructor() {
    const url = Deno.env.get('SIGNER_WEBHOOK_URL');
    const auth = Deno.env.get('SIGNER_WEBHOOK_AUTH');
    
    if (!url || !auth) {
      throw new Error('SIGNER_WEBHOOK_URL and SIGNER_WEBHOOK_AUTH must be set for webhook mode');
    }
    
    this.url = url;
    this.authToken = auth;
  }

  async sign(txPayload: TxPayload, chainId: number): Promise<string> {
    // Validate chain
    if (!ALLOWED_CHAIN_IDS.includes(chainId)) {
      throw new Error(`Chain ${chainId} not allowed`);
    }

    // Validate value cap
    const valueWei = BigInt(txPayload.value || '0');
    if (valueWei > MAX_TX_VALUE_WEI) {
      throw new Error(`Value ${valueWei} exceeds maximum ${MAX_TX_VALUE_WEI}`);
    }

    // Call webhook
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({ txPayload, chainId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook signer failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    const signedTx = result.signedTx;

    // Validate signed tx format
    if (!signedTx || typeof signedTx !== 'string' || !signedTx.startsWith('0x')) {
      throw new Error('Invalid signedTx from webhook: must be hex string starting with 0x');
    }

    return signedTx;
  }
}

/**
 * Local signer: signs transactions using private key (dev only)
 * Only enabled if SERVER_SIGNER_MODE=local AND SERVER_SIGNER_LOCAL=true
 */
class LocalSigner implements Signer {
  type: 'local' = 'local';
  private account: ReturnType<typeof privateKeyToAccount>;
  private rpcUrl: string;

  constructor() {
    const enableLocal = Deno.env.get('SERVER_SIGNER_LOCAL');
    if (enableLocal !== 'true') {
      throw new Error('Local signer requires SERVER_SIGNER_LOCAL=true');
    }

    const privateKey = Deno.env.get('BOT_PRIVATE_KEY');
    const botAddress = Deno.env.get('BOT_ADDRESS');
    
    if (!privateKey || !botAddress) {
      throw new Error('BOT_PRIVATE_KEY and BOT_ADDRESS must be set for local mode');
    }

    // Ensure private key has 0x prefix
    const pkHex = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    this.account = privateKeyToAccount(pkHex as `0x${string}`);
    
    // Verify derived address matches BOT_ADDRESS
    if (this.account.address.toLowerCase() !== botAddress.toLowerCase()) {
      throw new Error('Derived address from BOT_PRIVATE_KEY does not match BOT_ADDRESS');
    }

    const rpcUrl = Deno.env.get('RPC_URL_8453');
    if (!rpcUrl) {
      throw new Error('RPC_URL_8453 must be set for local signer');
    }
    this.rpcUrl = rpcUrl;
  }

  async sign(txPayload: TxPayload, chainId: number): Promise<string> {
    // Validate chain
    if (!ALLOWED_CHAIN_IDS.includes(chainId)) {
      throw new Error(`Chain ${chainId} not allowed`);
    }

    // Validate from address matches signer
    if (txPayload.from.toLowerCase() !== this.account.address.toLowerCase()) {
      throw new Error(`txPayload.from (${txPayload.from}) does not match signer address (${this.account.address})`);
    }

    // Validate value cap
    const valueWei = BigInt(txPayload.value || '0');
    if (valueWei > MAX_TX_VALUE_WEI) {
      throw new Error(`Value ${valueWei} exceeds maximum ${MAX_TX_VALUE_WEI}`);
    }

    // Get nonce
    const nonceResponse = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionCount',
        params: [this.account.address, 'latest'],
      }),
    });
    const nonceResult = await nonceResponse.json();
    const nonce = parseInt(nonceResult.result, 16);

    // Get gas price parameters
    const { maxPriorityFeePerGas, maxFeePerGas } = await this.estimateFees();

    // Build transaction
    const transaction = {
      to: txPayload.to as `0x${string}`,
      data: txPayload.data as `0x${string}`,
      value: valueWei,
      gas: BigInt(txPayload.gas),
      nonce,
      chainId,
      maxPriorityFeePerGas,
      maxFeePerGas,
    };

    // Sign transaction
    const signedTx = await this.account.signTransaction(transaction);
    return signedTx;
  }

  private async estimateFees(): Promise<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }> {
    try {
      // Try eth_feeHistory first
      const historyResponse = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_feeHistory',
          params: ['0x1', 'latest', [50]], // 1 block, 50th percentile
        }),
      });
      
      const historyResult = await historyResponse.json();
      
      if (historyResult.result) {
        const baseFee = BigInt(historyResult.result.baseFeePerGas[0]);
        const priorityFee = BigInt(historyResult.result.reward[0][0] || '1000000000'); // 1 gwei fallback
        
        return {
          maxPriorityFeePerGas: priorityFee,
          maxFeePerGas: baseFee * 2n + priorityFee, // 2x base fee + priority
        };
      }
    } catch (error) {
      console.warn('eth_feeHistory failed, falling back to gasPrice', error);
    }

    // Fallback to eth_gasPrice
    const gasPriceResponse = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_gasPrice',
        params: [],
      }),
    });
    
    const gasPriceResult = await gasPriceResponse.json();
    const gasPrice = BigInt(gasPriceResult.result);
    
    return {
      maxPriorityFeePerGas: gasPrice / 10n, // 10% of gas price as priority
      maxFeePerGas: gasPrice,
    };
  }
}

/**
 * Get configured signer based on environment
 */
export function getSigner(): Signer {
  const mode = Deno.env.get('SERVER_SIGNER_MODE') || 'webhook';
  
  if (mode === 'local') {
    return new LocalSigner();
  } else if (mode === 'webhook') {
    return new WebhookSigner();
  } else {
    throw new Error(`Invalid SERVER_SIGNER_MODE: ${mode}. Must be 'webhook' or 'local'`);
  }
}
