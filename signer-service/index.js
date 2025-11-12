import express from 'express';
import { createWalletClient, http, parseGwei, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const app = express();
app.use(express.json());

// Environment variables
const PORT = process.env.PORT || 3000;
const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;
const BOT_ADDRESS = process.env.BOT_ADDRESS?.toLowerCase();
const WEBHOOK_AUTH = process.env.WEBHOOK_AUTH;
const HMAC_ACTIVE = process.env.HMAC_ACTIVE || process.env.WEBHOOK_AUTH; // Dual HMAC support
const HMAC_PREVIOUS = process.env.HMAC_PREVIOUS || ''; // Previous HMAC during rotation
const RPC_URL = process.env.RPC_URL_8453 || 'https://mainnet.base.org';
const MAX_TX_VALUE_WEI = BigInt(process.env.MAX_TX_VALUE_WEI || '1000000000000000000'); // 1 ETH default
const VERSION = '1.1.0';

// Validation
if (!BOT_PRIVATE_KEY || !BOT_ADDRESS || !WEBHOOK_AUTH) {
  console.error('❌ Missing required env: BOT_PRIVATE_KEY, BOT_ADDRESS, or WEBHOOK_AUTH');
  process.exit(1);
}

// Setup viem client
const account = privateKeyToAccount(BOT_PRIVATE_KEY);
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(RPC_URL),
});

console.log('✅ Signer initialized:', {
  version: VERSION,
  botAddress: BOT_ADDRESS,
  chainId: base.id,
  rpcUrl: RPC_URL,
  maxValueWei: MAX_TX_VALUE_WEI.toString(),
});

// Middleware: Dual HMAC auth check (supports rotation)
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const xHmac = req.headers['x-hmac'];
  
  // Support both Authorization header (legacy) and x-hmac header
  const providedAuth = authHeader?.replace('Bearer ', '') || xHmac;
  
  if (!providedAuth) {
    console.warn('🔒 No auth provided:', { ip: req.ip, path: req.path });
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing authorization' });
  }
  
  // Check against active HMAC first, then previous (during rotation grace period)
  const isValid = providedAuth === HMAC_ACTIVE || 
                  (HMAC_PREVIOUS && providedAuth === HMAC_PREVIOUS);
  
  if (!isValid) {
    console.warn('🔒 Invalid HMAC:', { 
      ip: req.ip, 
      path: req.path,
      providedPrefix: providedAuth.substring(0, 8)
    });
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid HMAC' });
  }
  
  // Log which HMAC was used (for monitoring rotation)
  const usedKey = providedAuth === HMAC_ACTIVE ? 'active' : 'previous';
  if (usedKey === 'previous') {
    console.info('⚠️  Using HMAC_PREVIOUS (grace period):', { path: req.path });
  }
  
  next();
}

// Health endpoint
app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', version: VERSION, chain: 'base' });
});

// Version endpoint
app.get('/version', (req, res) => {
  res.json({
    version: VERSION,
    botAddress: BOT_ADDRESS,
    chainId: base.id,
    maxValueWei: MAX_TX_VALUE_WEI.toString(),
  });
});

// Sign endpoint
app.post('/sign', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const { chainId, from, to, data, value, gas, maxFeePerGas, maxPriorityFeePerGas, nonce } = req.body;

  // Log request (no sensitive data)
  console.log('📝 Sign request:', {
    chainId,
    from: from?.toLowerCase(),
    to: to?.toLowerCase(),
    value,
    hasData: !!data,
    gas,
    nonce,
  });

  try {
    // Validation: Chain ID
    if (chainId !== base.id) {
      console.error('❌ Invalid chain:', chainId);
      return res.status(400).json({ error: 'INVALID_CHAIN', message: 'Only Base (8453) supported' });
    }

    // Validation: From address
    if (from?.toLowerCase() !== BOT_ADDRESS) {
      console.error('❌ Invalid from:', from);
      return res.status(400).json({ error: 'INVALID_FROM', message: 'From address does not match bot' });
    }

    // Validation: To address
    if (!to || to === '0x0000000000000000000000000000000000000000') {
      console.error('❌ Invalid to:', to);
      return res.status(400).json({ error: 'INVALID_TO', message: 'Invalid recipient address' });
    }

    // Validation: Value cap
    const valueBigInt = BigInt(value || '0x0');
    if (valueBigInt > MAX_TX_VALUE_WEI) {
      console.error('❌ Value exceeds cap:', { value: valueBigInt.toString(), cap: MAX_TX_VALUE_WEI.toString() });
      return res.status(400).json({
        error: 'VALUE_EXCEEDS_CAP',
        message: `Value ${formatEther(valueBigInt)} ETH exceeds max ${formatEther(MAX_TX_VALUE_WEI)} ETH`,
      });
    }

    // Gas estimation if missing/zero
    let gasLimit = gas ? BigInt(gas) : 0n;
    if (gasLimit === 0n) {
      console.log('🔧 Estimating gas...');
      try {
        const estimated = await walletClient.estimateGas({
          account,
          to,
          data,
          value: valueBigInt,
        });
        gasLimit = (estimated * 110n) / 100n; // +10% buffer
        console.log(`✅ Gas estimated: ${estimated.toString()} → ${gasLimit.toString()} (with buffer)`);
      } catch (err) {
        console.error('❌ Gas estimation failed:', err.message);
        return res.status(400).json({ error: 'GAS_ESTIMATION_FAILED', message: err.message });
      }
    }

    // Fee estimation if missing
    let maxFee = maxFeePerGas ? BigInt(maxFeePerGas) : null;
    let maxPriorityFee = maxPriorityFeePerGas ? BigInt(maxPriorityFeePerGas) : null;

    if (!maxFee || !maxPriorityFee) {
      console.log('🔧 Fetching fee data...');
      try {
        // Try eth_feeHistory first
        const block = await walletClient.getBlock({ blockTag: 'latest' });
        const baseFeePerGas = block.baseFeePerGas || parseGwei('1');
        
        // Default priority fee (2 gwei is typical for Base)
        maxPriorityFee = maxPriorityFee || parseGwei('2');
        maxFee = maxFee || (baseFeePerGas * 2n + maxPriorityFee);

        console.log(`✅ Fees: maxFee=${formatEther(maxFee, 'gwei')} gwei, maxPriority=${formatEther(maxPriorityFee, 'gwei')} gwei`);
      } catch (err) {
        console.error('❌ Fee estimation failed:', err.message);
        // Fallback to reasonable defaults for Base
        maxPriorityFee = maxPriorityFee || parseGwei('2');
        maxFee = maxFee || parseGwei('10');
        console.log(`⚠️  Using fallback fees: maxFee=${formatEther(maxFee, 'gwei')} gwei`);
      }
    }

    // Get nonce if not provided
    let txNonce = nonce;
    if (txNonce === undefined) {
      txNonce = await walletClient.getTransactionCount({
        address: BOT_ADDRESS,
        blockTag: 'pending',
      });
      console.log(`✅ Nonce fetched: ${txNonce}`);
    }

    // Sign transaction
    console.log('✍️  Signing transaction...');
    const signedTx = await walletClient.signTransaction({
      account,
      to,
      data,
      value: valueBigInt,
      gas: gasLimit,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: maxPriorityFee,
      nonce: txNonce,
      chainId: base.id,
    });

    const elapsed = Date.now() - startTime;
    console.log(`✅ Transaction signed in ${elapsed}ms:`, {
      to: to.toLowerCase(),
      value: formatEther(valueBigInt),
      gas: gasLimit.toString(),
      nonce: txNonce,
      txLength: signedTx.length,
    });

    res.json({
      ok: true,
      signedTx,
      metadata: {
        chainId: base.id,
        from: BOT_ADDRESS,
        to: to.toLowerCase(),
        nonce: txNonce,
        gas: gasLimit.toString(),
        maxFeePerGas: maxFee.toString(),
        maxPriorityFeePerGas: maxPriorityFee.toString(),
        estimatedMs: elapsed,
      },
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('❌ Sign error:', {
      error: error.message,
      stack: error.stack?.split('\n')[0],
      elapsedMs: elapsed,
    });
    res.status(500).json({
      error: 'SIGNING_FAILED',
      message: error.message,
    });
  }
});

// Permit2 signing endpoint
app.post('/sign/permit2-single', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  const payload = req.body;

  console.log('📝 Permit2 sign request:', {
    chainId: payload?.domain?.chainId,
    token: payload?.message?.details?.token,
    amount: payload?.message?.details?.amount,
    spender: payload?.message?.spender,
  });

  try {
    // Validate payload structure
    if (!payload?.domain || !payload?.types || !payload?.message) {
      return res.status(400).json({ 
        error: 'INVALID_PAYLOAD', 
        message: 'Missing domain, types, or message' 
      });
    }

    // Validate chain ID
    if (payload.domain.chainId !== base.id) {
      return res.status(400).json({ 
        error: 'INVALID_CHAIN', 
        message: `Only Base (${base.id}) supported` 
      });
    }

    // Validate Permit2 contract
    const PERMIT2_CONTRACT = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
    if (payload.domain.verifyingContract?.toLowerCase() !== PERMIT2_CONTRACT.toLowerCase()) {
      return res.status(400).json({ 
        error: 'INVALID_CONTRACT', 
        message: 'Invalid Permit2 contract address' 
      });
    }

    // Sign the typed data
    console.log('✍️  Signing Permit2 typed data...');
    const signature = await walletClient.signTypedData({
      account,
      domain: payload.domain,
      types: payload.types,
      primaryType: payload.primaryType || 'PermitSingle',
      message: payload.message,
    });

    const elapsed = Date.now() - startTime;
    console.log(`✅ Permit2 signed in ${elapsed}ms:`, {
      signer: BOT_ADDRESS,
      sigLength: signature.length,
    });

    res.json({
      ok: true,
      signer: BOT_ADDRESS,
      signature,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('❌ Permit2 sign error:', {
      error: error.message,
      stack: error.stack?.split('\n')[0],
      elapsedMs: elapsed,
    });
    res.status(500).json({
      error: 'SIGNING_FAILED',
      message: error.message,
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Signer service running on port ${PORT}`);
  console.log(`   Health: GET /healthz`);
  console.log(`   Version: GET /version`);
  console.log(`   Sign: POST /sign (requires auth)`);
});
