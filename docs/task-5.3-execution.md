# Task 5.3 - Auto-Wrap Execution & Permit2 Path Finalization

## Overview

Task 5.3 enables controlled on-chain execution for the minimal happy path: **wrap → permit2 → swap**.

## Architecture

The system uses a **headless architecture** with separate endpoints:

1. **wallet-ensure-weth** - WETH balance check and auto-wrap
2. **wallet-permit2-status** - Permit2 allowance check
3. **wallet-permit2-submit** - Submit Permit2 approvals
4. **onchain-quote** - Get executable 0x quotes
5. **onchain-execute** - Build trades (stores in DB)
6. **onchain-sign-and-send** - Sign and broadcast transactions
7. **onchain-receipts** - Poll for transaction receipts

## Server Signer

The signer infrastructure supports two modes:

### Local Mode (Development)
```bash
SERVER_SIGNER_MODE=local
BOT_PRIVATE_KEY=0x...
BOT_ADDRESS=0x...
```

Signs transactions using the private key directly in the edge function.

### Webhook Mode (Production)
```bash
SERVER_SIGNER_MODE=webhook
SIGNER_WEBHOOK_URL=https://your-signer.example.com/sign
SIGNER_WEBHOOK_AUTH=your-secret-token
```

Forwards signing requests to an external service (e.g., Railway-hosted signer).

## Safety Controls

### Dry-Run Mode (Default)
```bash
EXECUTION_DRY_RUN=true  # Default: blocks all writes
```

All execution endpoints will simulate but not broadcast transactions until explicitly disabled.

### Auto-Wrap Control
```bash
ENABLE_AUTO_WRAP=true  # Enables automatic WETH wrapping
```

When enabled, `wallet-ensure-weth` can automatically wrap ETH to WETH when needed.

### Value Caps
```bash
MAX_TX_VALUE_WEI=100000000000000000  # 0.1 ETH max per transaction
MAX_WRAP_WEI=50000000000000000       # 0.05 ETH max wrap
```

### Slippage Floor
```bash
SLIPPAGE_BPS_FLOOR=50  # Minimum 0.5% slippage
```

### Single Owner Enforcement

All live execution requires `taker === BOT_ADDRESS` in local mode.

## Testing

### Dry-Run Test (Safe)
```javascript
fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/test-live-sell', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amountEth: '0.0001',
    slippageBps: 50,
    dryRun: true  // Default: safe dry-run
  })
}).then(r => r.json()).then(console.log);
```

### Live Execution (Requires Configuration)
```javascript
// ⚠️ ONLY RUN WITH PROPER SAFETY CONTROLS
fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/test-live-sell', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    amountEth: '0.0001',
    slippageBps: 50,
    dryRun: false  // ⚠️ LIVE EXECUTION
  })
}).then(r => r.json()).then(console.log);
```

## Test Flow

The `test-live-sell` endpoint executes:

1. **Config Validation** - Checks safety limits and environment
2. **WETH Check** - Verifies WETH balance (read-only)
3. **Permit2 Check** - Verifies Permit2 allowance
4. **Quote** - Gets 0x v2 quote for SELL ETH→USDC
5. **Dry-Run Exit** - Stops here if `dryRun=true`
6. **Build** *(live only)* - Creates trade record in DB
7. **Sign & Send** *(live only)* - Signs and broadcasts transaction
8. **Receipt** *(live only)* - Polls for transaction confirmation

## Execution Flow

### Manual Execution
```javascript
// 1. Build the trade
const build = await fetch(PROJECT_URL + '/functions/v1/onchain-execute', {
  method: 'POST',
  body: JSON.stringify({
    chainId: 8453,
    base: 'ETH',
    quote: 'USDC',
    side: 'SELL',
    amount: 0.0001,
    slippageBps: 50,
    provider: '0x',
    taker: '0xYourAddress',
    mode: 'build'
  })
});

const { tradeId } = await build.json();

// 2. Sign and broadcast
const send = await fetch(PROJECT_URL + '/functions/v1/onchain-sign-and-send', {
  method: 'POST',
  body: JSON.stringify({ tradeId })
});

const { tx_hash } = await send.json();

// 3. Poll for receipt
const receipt = await fetch(PROJECT_URL + '/functions/v1/onchain-receipts', {
  method: 'POST',
  body: JSON.stringify({ tradeId })
});
```

## Logging Keys

All execution flows use structured logging:

```typescript
// WETH operations
ensure_weth.check.start {address, minWeth, autoWrap}
ensure_weth.check.done {currentWethBalance, needed, sufficient}
ensure_weth.wrap.start {deficitWei, valueHuman}
ensure_weth.wrap.sent {txHash}
ensure_weth.wrap.confirmed {txHash, gasUsed}

// Permit2 operations
wallet_permit2_submit.start {owner, token}
wallet_permit2_submit.signed {signedTx}
wallet_permit2_submit.sent {txHash}

// Trade operations
onchain_execute.quote.start {chainId, side, amount}
onchain_execute.quote.done {provider, price, minOut}
onchain_execute.build.done {tradeId, status}

// Signing operations
onchain_sign_and_send.sign.start {tradeId, signerType}
onchain_sign_and_send.sign.done {txHash}
onchain_sign_and_send.broadcast.done {txHash}

// Receipt polling
onchain_receipts.poll.start {tradeId}
onchain_receipts.poll.done {status, gasUsed, blockNumber}

// Test operations
test_live_sell.start {dryRun, amountEth, slippageBps}
test_live_sell.weth_check.done {action, wrapNeeded}
test_live_sell.permit2_check.done {action, approvalNeeded}
test_live_sell.quote.done {provider, price, minOut}
test_live_sell.build.done {tradeId}
test_live_sell.sign_and_send.done {txHash}
test_live_sell.receipt.done {status, gasUsed}
test_live_sell.complete {tradeId, txHash, executionTimeMs}
```

## Error Taxonomy

```typescript
// Configuration errors
BOT_ADDRESS_NOT_CONFIGURED
SIGNER_MODE_UNSUPPORTED
MISSING_ENV

// Validation errors
AMOUNT_EXCEEDS_LIMIT
INVALID_ADDRESS_FORMAT
TAKER_MISMATCH

// Execution errors
INSUFFICIENT_WETH
INSUFFICIENT_ETH
PERMIT2_REQUIRED
VALUE_CAP_EXCEEDED
TO_NOT_ALLOWED

// RPC errors
SIGNING_FAILED
BROADCAST_FAILED
TIMEOUT
RPC_ERROR
```

## Security Features

1. **Router Allowlist** - Only allowed contract addresses can be transaction targets
2. **Value Cap** - Maximum transaction value enforced
3. **Single Owner** - Only BOT_ADDRESS can execute in local mode
4. **Signature Validation** - EIP-712 signature checks for Permit2
5. **Preflight Checks** - WETH and Permit2 validation before execution
6. **Idempotency** - Prevents duplicate transactions
7. **Audit Trail** - All operations logged to `trade_events` table

## Next Steps

1. **Test dry-run** - Verify flow without on-chain writes
2. **Configure signer** - Set up local or webhook mode
3. **Set safety limits** - Configure value caps and slippage
4. **Enable auto-wrap** - Set `ENABLE_AUTO_WRAP=true` if desired
5. **Disable dry-run** - Set `EXECUTION_DRY_RUN=false` when ready
6. **Execute test trade** - Run tiny SELL with `dryRun=false`
7. **Monitor logs** - Check edge function logs for execution trace
8. **Verify receipt** - Confirm transaction on BaseScan

## Monitoring

View logs for each function:
- [test-live-sell logs](https://supabase.com/dashboard/project/fuieplftlcxdfkxyqzlt/functions/test-live-sell/logs)
- [onchain-execute logs](https://supabase.com/dashboard/project/fuieplftlcxdfkxyqzlt/functions/onchain-execute/logs)
- [onchain-sign-and-send logs](https://supabase.com/dashboard/project/fuieplftlcxdfkxyqzlt/functions/onchain-sign-and-send/logs)
- [onchain-receipts logs](https://supabase.com/dashboard/project/fuieplftlcxdfkxyqzlt/functions/onchain-receipts/logs)
