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
  getAddress(): string | null;
}

/**
 * Webhook signer: delegates signing to external service
 */
class WebhookSigner implements Signer {
  type: 'webhook' = 'webhook';
  private url: string;
  private authToken: string;
  private botAddress: string | null;

  constructor() {
    const url = Deno.env.get('SIGNER_WEBHOOK_URL');
    const auth = Deno.env.get('SIGNER_WEBHOOK_AUTH');
    
    if (!url || !auth) {
      throw new Error('SIGNER_WEBHOOK_URL and SIGNER_WEBHOOK_AUTH must be set for webhook mode');
    }
    
    this.url = url;
    this.authToken = auth;
    this.botAddress = Deno.env.get('BOT_ADDRESS') || null;
  }

  getAddress(): string | null {
    return this.botAddress;
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

  getAddress(): string {
    return this.account.address;
  }

  async sign(txPayload: TxPayload, chainId: number): Promise<string> {
    // ═══════════════════════════════════════════════════════════════════════
    // DIAGNOSTIC STEP B-1: What the signer RECEIVES
    // ═══════════════════════════════════════════════════════════════════════
    console.log("🔍 [DIAG-B1] SIGNER RECEIVED txPayload:", {
      to: txPayload.to,
      from: txPayload.from,
      value: txPayload.value,
      gas: txPayload.gas,
      data_exists: !!txPayload.data,
      data_type: typeof txPayload.data,
      data_length: txPayload.data?.length || 0,
      data_first_20: txPayload.data?.substring(0, 20) || "EMPTY",
      data_last_20: txPayload.data?.slice(-20) || "EMPTY",
      txPayload_keys: Object.keys(txPayload),
    });
    
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

    // Normalize gas
    const gasStr = txPayload.gas ?? '0x0';
    let gas: bigint;
    
    if (gasStr.startsWith('0x')) {
      gas = BigInt(gasStr);
    } else if (/^\d+$/.test(gasStr)) {
      gas = BigInt(gasStr);
    } else {
      gas = 0n;
    }

    // If gas is 0, estimate it with 10% buffer
    if (gas === 0n) {
      console.log("🔍 [DIAG] Gas is 0, estimating...");
      const estimateResponse = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_estimateGas',
          params: [{
            from: txPayload.from,
            to: txPayload.to,
            data: txPayload.data,
            value: '0x' + valueWei.toString(16),
          }],
        }),
      });
      const estimateResult = await estimateResponse.json();
      if (estimateResult.error) {
        throw new Error(`Gas estimation failed: ${estimateResult.error.message}`);
      }
      gas = BigInt(estimateResult.result) * 110n / 100n;
      console.log("🔍 [DIAG] Estimated gas:", gas.toString());
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
      gas,
      nonce,
      chainId,
      maxPriorityFeePerGas,
      maxFeePerGas,
    };

    // ═══════════════════════════════════════════════════════════════════════
    // DIAGNOSTIC STEP B-2: Transaction object BEFORE signing
    // ═══════════════════════════════════════════════════════════════════════
    console.log("🔍 [DIAG-B2] TRANSACTION object before signing:", {
      to: transaction.to,
      data_exists: !!transaction.data,
      data_type: typeof transaction.data,
      data_length: transaction.data?.length || 0,
      data_first_20: transaction.data?.substring(0, 20) || "EMPTY",
      data_last_20: transaction.data?.slice(-20) || "EMPTY",
      value: transaction.value.toString(),
      gas: transaction.gas.toString(),
      nonce: transaction.nonce,
      chainId: transaction.chainId,
      maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString(),
      maxFeePerGas: transaction.maxFeePerGas.toString(),
    });

    // Sign transaction
    const signedTx = await this.account.signTransaction(transaction);
    
    // ═══════════════════════════════════════════════════════════════════════
    // DIAGNOSTIC STEP B-3: Signed transaction result
    // ═══════════════════════════════════════════════════════════════════════
    console.log("🔍 [DIAG-B3] SIGNED TX result:", {
      signedTx_length: signedTx.length,
      signedTx_first_40: signedTx.substring(0, 40),
      signedTx_last_20: signedTx.slice(-20),
    });
    
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
