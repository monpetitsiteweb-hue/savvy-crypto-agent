# On-Chain Execution API

The `/onchain-execute` Edge Function enables on-chain swap execution via 0x on Base and Arbitrum, with built-in safety features including simulation, minOut protection, and trade persistence.

## Features

- **Quote Integration**: Automatically fetches quotes from `/onchain-quote`
  - When `taker` is provided: Uses 0x `/quote` endpoint → returns price + executable transaction
  - Without `taker`: Uses 0x `/price` endpoint → returns price only (no transaction)
- **Simulation**: Optional `eth_call` simulation to verify transaction will succeed before sending
- **Flexible Modes**: 
  - `build` mode: Returns unsigned transaction payload for client-side signing
  - `send` mode: Accepts signed transaction and broadcasts to network
- **Trade Persistence**: All trades stored in `public.trades` with full audit trail in `public.trade_events`
- **Status Tracking**: Track trades through lifecycle: `built` → `submitted` → `mined`/`failed`

## API Endpoints

### POST /onchain-execute

Execute or build a swap transaction.

**Request Body:**

```json
{
  "chainId": 8453,              // 1 (Ethereum), 8453 (Base), or 42161 (Arbitrum)
  "base": "ETH",                // Base token symbol or address
  "quote": "USDC",              // Quote token symbol or address
  "side": "SELL",               // SELL or BUY
  "amount": 1,                  // Amount in human units
  "slippageBps": 50,            // Optional: slippage in basis points (default: 50)
  "provider": "0x",             // Optional: provider (default: "0x")
  "taker": "0x...",             // REQUIRED for build/send modes: your wallet address
  "mode": "build",              // Optional: "build" or "send" (default: "build")
  "simulateOnly": false,        // Optional: true to only simulate, not execute (default: false)
  "signedTx": "0x..."           // Required for send mode: signed raw transaction
}
```

**Validation:**
- `taker` must match regex `^0x[0-9a-fA-F]{40}$` if provided
- `side` must be `SELL` or `BUY`
- `mode` must be `build` or `send`

**Response (build mode):**

```json
{
  "tradeId": "uuid",
  "status": "built",
  "price": 4145.23,
  "minOut": "4145230000",
  "gasCostQuote": 0.0234,
  "unit": "USDC/ETH",
  "txPayload": {
    "to": "0x...",
    "data": "0x...",
    "value": "0x0",
    "gas": "0x...",
    "from": "0x..."
  },
  "raw": { /* full quote response */ }
}
```

**Response (send mode, submitted):**

```json
{
  "tradeId": "uuid",
  "status": "submitted",
  "txHash": "0x...",
  "price": 4145.23,
  "minOut": "4145230000",
  "gasCostQuote": 0.0234,
  "unit": "USDC/ETH",
  "raw": { /* full quote response */ }
}
```

**Response (simulation failed):**

```json
{
  "tradeId": "uuid",
  "status": "simulate_revert",
  "error": "execution reverted: ...",
  "price": 4145.23,
  "minOut": "4145230000",
  "gasCostQuote": 0.0234,
  "unit": "USDC/ETH"
}
```

### GET /onchain-execute?tradeId={uuid}

Retrieve a trade by ID with full event history.

**Response:**

```json
{
  "trade": {
    "id": "uuid",
    "created_at": "2025-09-29T12:00:00Z",
    "updated_at": "2025-09-29T12:00:05Z",
    "chain_id": 8453,
    "base": "ETH",
    "quote": "USDC",
    "side": "SELL",
    "amount": 1,
    "slippage_bps": 50,
    "provider": "0x",
    "taker": "0x...",
    "mode": "send",
    "simulate_only": false,
    "price": 4145.23,
    "min_out": "4145230000",
    "gas_quote": 0.0234,
    "status": "submitted",
    "tx_hash": "0x...",
    "tx_payload": { /* transaction object */ },
    "receipts": null,
    "effective_price": null,
    "gas_wei": null,
    "total_network_fee": null,
    "notes": null,
    "raw_quote": { /* full quote response */ }
  },
  "events": [
    {
      "id": 1,
      "trade_id": "uuid",
      "created_at": "2025-09-29T12:00:00Z",
      "phase": "quote",
      "severity": "info",
      "payload": { /* quote data */ }
    },
    {
      "id": 2,
      "trade_id": "uuid",
      "created_at": "2025-09-29T12:00:02Z",
      "phase": "simulate",
      "severity": "info",
      "payload": { "success": true, "result": "0x..." }
    },
    {
      "id": 3,
      "trade_id": "uuid",
      "created_at": "2025-09-29T12:00:05Z",
      "phase": "submit",
      "severity": "info",
      "payload": { "txHash": "0x..." }
    }
  ]
}
```

## Wallet Helper Endpoints

### POST /wallet-ensure-weth

Check if wallet has sufficient WETH balance. Returns wrap plan if balance insufficient.

**Request:**
```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "minWethNeeded": "1000000000000000000"  // Wei string
}
```

**Response (sufficient balance):**
```json
{
  "ok": true,
  "action": "none",
  "balance": "2000000000000000000",
  "balanceHuman": "2.000000"
}
```

**Response (need to wrap):**
```json
{
  "ok": true,
  "action": "wrap",
  "balance": "500000000000000000",
  "balanceHuman": "0.500000",
  "wrapPlan": {
    "chainId": 8453,
    "wethAddress": "0x4200000000000000000000000000000000000006",
    "method": "deposit()",
    "calldata": "0xd0e30db0",
    "value": "500000000000000000",
    "valueHuman": "0.500000",
    "note": "Wrap 0.500000 ETH to WETH. Send this value to WETH.deposit()"
  }
}
```

**Client execution (if wrap needed):**
```typescript
// Using ethers.js
const wethContract = new ethers.Contract(
  wrapPlan.wethAddress,
  ['function deposit() payable'],
  signer
);
const tx = await wethContract.deposit({ value: wrapPlan.value });
await tx.wait();
```

### POST /wallet-permit2-status

Check Permit2 allowance for 0x spender. Returns EIP-712 typed data if approval needed.

**Request:**
```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "token": "WETH",  // or "USDC"
  "minAllowance": "1000000000000000000"  // Wei string
}
```

**Response (sufficient allowance):**
```json
{
  "ok": true,
  "action": "none",
  "allowance": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  "allowanceHuman": "1.157921e+59"
}
```

**Response (need approval):**
```json
{
  "ok": true,
  "action": "permit2-sign",
  "allowance": "0",
  "allowanceHuman": "0.000000",
  "typedData": {
    "domain": {
      "name": "Permit2",
      "chainId": 8453,
      "verifyingContract": "0x000000000022D473030F116dDEE9F6B43aC78BA3"
    },
    "types": {
      "PermitSingle": [
        { "name": "details", "type": "PermitDetails" },
        { "name": "spender", "type": "address" },
        { "name": "sigDeadline", "type": "uint256" }
      ],
      "PermitDetails": [
        { "name": "token", "type": "address" },
        { "name": "amount", "type": "uint160" },
        { "name": "expiration", "type": "uint48" },
        { "name": "nonce", "type": "uint48" }
      ]
    },
    "primaryType": "PermitSingle",
    "message": {
      "details": {
        "token": "0x4200000000000000000000000000000000000006",
        "amount": "1461501637330902918203684832716283019655932542975",
        "expiration": "1759424621",
        "nonce": "0"
      },
      "spender": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
      "sigDeadline": "1759393221"
    }
  },
  "permit2Contract": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "spender": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "note": "Sign this EIP-712 data with your wallet, then call Permit2.permit() with signature"
}
```

**Client execution (if approval needed):**
```typescript
// Step 1: Sign EIP-712 typed data
const signature = await signer._signTypedData(
  typedData.domain,
  typedData.types,
  typedData.message
);

// Step 2: Submit to Permit2 contract
const permit2Contract = new ethers.Contract(
  permit2Contract,
  [
    'function permit(address owner, tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)'
  ],
  signer
);

const tx = await permit2Contract.permit(
  address, // owner
  {
    details: typedData.message.details,
    spender: typedData.message.spender,
    sigDeadline: typedData.message.sigDeadline
  },
  signature
);
await tx.wait();
```

## Usage Examples

### Example 1: Build transaction for client-side signing (recommended)

```typescript
// Step 1: Build transaction
const buildResponse = await fetch(`${SUPABASE_URL}/functions/v1/onchain-execute`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  },
  body: JSON.stringify({
    chainId: 8453,
    base: 'ETH',
    quote: 'USDC',
    side: 'SELL',
    amount: 1,
    slippageBps: 50,
    taker: '0xYourAddress...',
    mode: 'build',
  }),
});

const buildData = await buildResponse.json();
console.log('Transaction to sign:', buildData.txPayload);

// Step 2: Sign transaction on client (e.g., with ethers, viem, etc.)
const signedTx = await wallet.signTransaction(buildData.txPayload);

// Step 3: Send signed transaction
const sendResponse = await fetch(`${SUPABASE_URL}/functions/v1/onchain-execute`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  },
  body: JSON.stringify({
    chainId: 8453,
    base: 'ETH',
    quote: 'USDC',
    side: 'SELL',
    amount: 1,
    slippageBps: 50,
    taker: '0xYourAddress...',
    mode: 'send',
    signedTx,
  }),
});

const sendData = await sendResponse.json();
console.log('Transaction hash:', sendData.txHash);
```

### Example 2: Simulate transaction only

```typescript
const response = await fetch(`${SUPABASE_URL}/functions/v1/onchain-execute`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  },
  body: JSON.stringify({
    chainId: 8453,
    base: 'ETH',
    quote: 'USDC',
    side: 'SELL',
    amount: 1,
    taker: '0xYourAddress...',
    simulateOnly: true,
  }),
});

const data = await response.json();
if (data.status === 'simulate_revert') {
  console.error('Simulation failed:', data.error);
} else {
  console.log('Simulation successful, expected price:', data.price);
}
```

### Example 3: Retrieve trade status

```typescript
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/onchain-execute?tradeId=${tradeId}`,
  {
    headers: {
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
  }
);

const data = await response.json();
console.log('Trade status:', data.trade.status);
console.log('Events:', data.events);
```

## Database Schema

### `public.trades`

Stores all trade execution attempts with full lifecycle tracking.

**Key Fields:**
- `taker`: EOA address (validated: `^0x[0-9a-fA-F]{40}$`)
- `mode`: `build` or `send`
- `status`: `built` → `submitted` → `mined`/`failed` or `simulate_revert`
- `raw_quote`: Full quote response from `/onchain-quote`
- `tx_payload`: Unsigned transaction object (for build mode)
- `tx_hash`: Transaction hash (for send mode)
- `receipts`: Transaction receipt (when mined)

### `public.trade_events`

Append-only audit trail of trade execution steps.

**Phases:**
- `quote`: Quote fetched from `/onchain-quote`
- `simulate`: Transaction simulation result
- `approve`: Approval transaction (if needed)
- `submit`: Transaction submitted to network
- `mined`: Transaction confirmed on-chain
- `error`: Error occurred during execution

**Severities:** `info`, `warn`, `error`

## Security & Access Control

**RLS (Row-Level Security):**
- RLS is **enabled** on both `trades` and `trade_events` tables
- **No policies** are configured by default
- All DB operations use **service role key** (bypasses RLS)
- Client-side reads/writes are **blocked** by default

**Adding Per-User Policies (Optional):**

If you want to allow users to view their own trades:

```sql
-- Example: Allow users to view trades where taker matches their address
-- (Requires plumbing user's EVM address via custom header or JWT claim)

create policy "User can select own trades"
  on public.trades for select to authenticated
  using (
    auth.role() = 'authenticated' 
    and taker is not null 
    and lower(taker) = lower(current_setting('request.headers', true)::json->>'x-evm-address')
  );

create policy "User can select own trade events"
  on public.trade_events for select to authenticated
  using (
    exists (
      select 1 from public.trades
      where trades.id = trade_events.trade_id
        and lower(trades.taker) = lower(current_setting('request.headers', true)::json->>'x-evm-address')
    )
  );
```

## Environment Variables

- `SB_URL`: Supabase project URL
- `SB_SERVICE_ROLE`: Service role key (required for DB operations)
- `RPC_URL_1`: Ethereum RPC URL (default: `https://eth.llamarpc.com`)
- `RPC_URL_8453`: Base RPC URL (default: `https://base.llamarpc.com`)
- `RPC_URL_42161`: Arbitrum RPC URL (default: `https://arbitrum.llamarpc.com`)
- `ZEROEX_API_KEY`: 0x API key (optional but recommended)

## Deploy Quickstart (Windows/PowerShell)

```powershell
supabase link --project-ref fuieplftlcxdfkxyqzlt
supabase secrets set SB_URL="https://fuieplftlcxdfkxyqzlt.supabase.co"
supabase secrets set SB_SERVICE_ROLE="<service-role-key>"
supabase secrets set ZEROEX_API_KEY="<0x-key>"
supabase secrets set RPC_URL_1="https://eth.llamarpc.com"
supabase secrets set RPC_URL_8453="https://base.llamarpc.com"
supabase secrets set RPC_URL_42161="https://arbitrum.llamarpc.com"
supabase functions deploy onchain-execute
supabase functions deploy onchain-quote
supabase functions deploy wallet-ensure-weth
supabase functions deploy wallet-permit2-status
```

## PowerShell Test Script

```powershell
# Configuration
$env:SUPABASE_ANON_KEY = "your-anon-key"
$BASE  = 'https://fuieplftlcxdfkxyqzlt.functions.supabase.co'
$EXEC  = "$BASE/onchain-execute"
$QUOTE = "$BASE/onchain-quote"

$Headers = @{
  'Authorization' = "Bearer $($env:SUPABASE_ANON_KEY)"
  'Content-Type'  = 'application/json'
}

# Helper: Execute trade
function Invoke-Execute {
  param(
    [int]$chainId,
    [string]$base,
    [string]$quote,
    [ValidateSet('SELL','BUY')] [string]$side,
    [double]$amount,
    [int]$slippageBps = 50,
    [string]$taker = '',
    [ValidateSet('build','send')] [string]$mode = 'build',
    [bool]$simulateOnly = $false,
    [string]$signedTx = $null
  )

  $body = @{
    chainId      = $chainId
    base         = $base
    quote        = $quote
    side         = $side
    amount       = $amount
    slippageBps  = $slippageBps
    mode         = $mode
    simulateOnly = $simulateOnly
  }
  if ($taker -and $taker -ne '') { $body.taker = $taker }
  if ($signedTx) { $body.signedTx = $signedTx }

  $json = $body | ConvertTo-Json -Depth 10

  try {
    $res = Invoke-RestMethod -Method POST -Uri $EXEC -Headers $Headers -Body $json
  } catch {
    if ($_.Exception.Response) {
      $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $text = $sr.ReadToEnd()
      Write-Error "HTTP error $($_.Exception.Response.StatusCode): $text"
    } else {
      Write-Error "HTTP error: $($_.Exception.Message)"
    }
    return
  }

  $res | Select-Object tradeId,status,price,minOut,gasCostQuote,unit,txHash | Format-List
  return $res
}

# Helper: Get trade by ID (explicit URL building for PowerShell)
function Get-Trade {
  param([Parameter(Mandatory=$true)][string]$tradeId)
  
  # Build URL explicitly (PowerShell needs this for proper parsing)
  $execBase = 'https://fuieplftlcxdfkxyqzlt.functions.supabase.co/onchain-execute'
  $url = "${execBase}?tradeId=${tradeId}"
  
  try {
    $res = Invoke-RestMethod -Method GET -Uri $url -Headers $Headers
  } catch {
    Write-Error "GET error: $($_.Exception.Message)"
    return
  }
  $res.trade | Select-Object id,status,chain_id,base,quote,side,amount,tx_hash | Format-List
  if ($res.events -and $res.events.Count -gt 0) {
    "Last event:"; ($res.events[-1] | Select-Object created_at,phase,severity) | Format-List
  }
  return $res
}

# Helper: Assert txPayload exists
function Assert-HasTxPayload {
  param($execResult)
  if (-not $execResult) { throw "No result object." }
  if (-not $execResult.txPayload) { throw "Missing txPayload in build response." }
  if (-not $execResult.txPayload.to -or -not $execResult.txPayload.data) {
    throw "txPayload incomplete (to/data missing)."
  }
  "txPayload looks present."
}

# Helper: Assert quote snapshot
function Assert-QuoteSnapshot {
  param($execResult)
  if (-not $execResult) { throw "No result object." }
  if (-not $execResult.price -or $execResult.price -le 0) { throw "Invalid or missing price." }
  if ($execResult.unit -notmatch '\/') { throw "Missing/invalid unit." }
  "Quote snapshot OK."
}

# Test 0: Quote sanity check
Write-Host "`n=== Test 0: Quote Sanity ===" -ForegroundColor Cyan
Invoke-RestMethod -Method POST -Uri $QUOTE -Headers $Headers -Body (@{
  chainId=8453; base='ETH'; quote='USDC'; side='SELL'; amount='1'; slippageBps=50
} | ConvertTo-Json) | Select-Object provider,price,unit,gasCostQuote | Format-List

# Test 1: Build transaction
Write-Host "`n=== Test 1: Build Transaction ===" -ForegroundColor Cyan
$taker = '0x0000000000000000000000000000000000000001'
$r1 = Invoke-Execute 8453 'ETH' 'USDC' 'SELL' 1 -taker $taker -mode 'build'
Assert-QuoteSnapshot $r1
Assert-HasTxPayload  $r1

# Test 2: GET by ID
Write-Host "`n=== Test 2: GET Trade by ID ===" -ForegroundColor Cyan
if ($r1.tradeId) {
  $g1 = Get-Trade $r1.tradeId
  "Retrieved trade: $($g1.trade.status)"
} else {
  Write-Warning "No tradeId in response"
}
```

## Verification Queries

### Recent trades

```sql
select created_at, chain_id, side, base, quote, amount, provider, status, tx_hash
from public.trades 
order by created_at desc 
limit 10;
```

### Failed trades with reasons

```sql
select created_at, status, notes, raw_quote->'debug' as debug
from public.trades 
where status in ('failed','simulate_revert')
order by created_at desc 
limit 20;
```

### Success rate today

```sql
select 
  count(*) filter (where status='mined')::float / nullif(count(*),0) as mined_rate
from public.trades 
where created_at::date = now()::date;
```

### Trade with full event history

```sql
select 
  t.*,
  json_agg(te.* order by te.created_at) as events
from public.trades t
left join public.trade_events te on te.trade_id = t.id
where t.id = 'trade-uuid-here'
group by t.id;
```

## Status Transitions

```
built ──────────┐
                │
                ├──> simulate_revert (simulation failed)
                │
                ├──> submitted ──> mined (success)
                │
                └──> submitted ──> failed (tx reverted or error)
```

## Notes

- **Private Keys**: This implementation does NOT hold private keys. Client must sign transactions.
- **Gas Estimation**: Gas estimates come from 0x quote; actual gas used may vary.
- **Slippage**: `minOut` protects against slippage; transaction will revert if output is less than `minOut`.
- **Simulation**: Not foolproof; blockchain state may change between simulation and execution.
- **Receipt Polling**: Current implementation returns immediately after submission; client should poll for receipt or implement background polling.

## Support

For issues or questions:
1. Check Edge Function logs: https://supabase.com/dashboard/project/{project_id}/functions/onchain-execute/logs
2. Review trade events in database for execution details
3. Verify RPC endpoints are accessible and API keys are valid
