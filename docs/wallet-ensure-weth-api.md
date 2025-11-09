# wallet-ensure-weth API Documentation

## Overview
Checks WETH balance and optionally executes ETH→WETH wrap transactions on Base (chain ID 8453).

## Endpoint
`POST /wallet-ensure-weth`

## Input Schema

### Required Fields
- `action`: `"plan"` | `"submit"`
  - `"plan"`: Returns wrap plan only, no on-chain execution
  - `"submit"`: Executes wrap transaction (requires policy flags)
  
- `owner`: `string`
  - Must be a valid 0x-prefixed 40-hex address (case-insensitive)
  - When `action="submit"`, must match `BOT_ADDRESS`

- `minWethNeededWei`: `string`
  - Decimal string representing wei amount (e.g., `"1000000000000000000"` for 1 WETH)
  - Must match regex: `^[0-9]+$`
  - Must be parseable by `BigInt()`

### Optional Fields
- `maxWaitMs`: `number` (default: `8000`)
  - Maximum time to wait for transaction receipt (submit mode only)

### Legacy Field Support (Backward Compatible)
The endpoint accepts these legacy field names for backward compatibility:
- `address` → normalized to `owner`
- `amountWei` → normalized to `minWethNeededWei`
- `minWethNeeded` → normalized to `minWethNeededWei`
- `autoWrap: boolean` → mapped to `action` (`true` → `"submit"`, `false` → `"plan"`)

When legacy fields are used, the function logs:
```json
{
  "input.alias_used": {
    "field": "amountWei",
    "normalizedTo": "minWethNeededWei"
  }
}
```

## Response Schema

### Success Response (Sufficient Balance)
```json
{
  "ok": true,
  "mode": "plan" | "submit",
  "minWethNeededWei": "1000000000000000",
  "action": "none",
  "wethBalanceWei": "5000000000000000",
  "balanceHuman": "0.005"
}
```

### Success Response (Wrap Needed - Plan Mode)
```json
{
  "ok": true,
  "mode": "plan",
  "minWethNeededWei": "1000000000000000",
  "action": "wrap",
  "wethBalanceWei": "0",
  "balanceHuman": "0.0",
  "plan": {
    "chainId": 8453,
    "wethAddress": "0x4200000000000000000000000000000000000006",
    "method": "deposit()",
    "calldata": "0xd0e30db0",
    "value": "1000000000000000",
    "valueHuman": "0.001",
    "note": "Wrap 0.001 ETH to WETH. Send this value to WETH.deposit()"
  }
}
```

### Success Response (Wrap Executed - Submit Mode)
```json
{
  "ok": true,
  "action": "wrap",
  "txHash": "0xabc123...",
  "gasUsed": 27000,
  "wethBalanceWei": "1000000000000000",
  "balanceHuman": "0.001",
  "log": {
    "executionTimeMs": 3500,
    "gasUsed": 27000,
    "deficitWei": "1000000000000000"
  }
}
```

### Success Response (Pending Transaction)
```json
{
  "ok": true,
  "action": "pending",
  "txHash": "0xabc123...",
  "note": "Transaction already in progress"
}
```

## Error Responses

### 400 Bad Request
**Invalid JSON:**
```json
{
  "ok": false,
  "code": "bad_json",
  "message": "Invalid JSON body"
}
```

**Missing or invalid owner:**
```json
{
  "ok": false,
  "code": "bad_request",
  "message": "owner is required"
}
```
```json
{
  "ok": false,
  "code": "bad_request",
  "message": "owner must be a valid 0x-prefixed address"
}
```

**Missing or invalid minWethNeededWei:**
```json
{
  "ok": false,
  "code": "bad_request",
  "message": "minWethNeededWei must be a decimal string"
}
```

**Invalid action:**
```json
{
  "ok": false,
  "code": "bad_request",
  "message": "action must be \"plan\" or \"submit\""
}
```

### 409 Conflict
**Address mismatch (submit mode):**
```json
{
  "ok": false,
  "code": "address_mismatch",
  "message": "Only BOT_ADDRESS can use action=submit",
  "details": {
    "owner": "0x123...",
    "expected": "0xabc..."
  }
}
```

### 422 Unprocessable Entity
**Insufficient ETH for wrap:**
```json
{
  "ok": false,
  "code": "insufficient_eth",
  "message": "Insufficient ETH balance for wrap",
  "details": {
    "ethNeeded": "1.0003",
    "ethAvailable": "0.5",
    "wrapAmount": "1.0"
  }
}
```

### 500 Internal Server Error
**Missing environment variables:**
```json
{
  "ok": false,
  "code": "missing_env",
  "message": "BOT_ADDRESS not configured"
}
```

**RPC error:**
```json
{
  "ok": false,
  "code": "unexpected",
  "message": "Failed to read WETH balance",
  "detail": { /* RPC error details */ }
}
```

**Transaction broadcast failure:**
```json
{
  "ok": false,
  "code": "tx_failed",
  "message": "Failed to broadcast transaction",
  "detail": "..."
}
```

### 504 Gateway Timeout
**Transaction timeout:**
```json
{
  "ok": false,
  "code": "timeout",
  "message": "Transaction timeout or failed",
  "detail": "...",
  "txHash": "0xabc123..."
}
```

## Logging Keys

### Input Validation
- `exec.error`: Validation errors with `code`, `message`, `field`
- `input.alias_used`: Legacy field normalization

### Execution Flow
- `ensure_weth.check.start`: Check initiated
- `ensure_weth.check.done`: Balance check complete
- `ensure_weth.wrap.start`: Wrap execution started
- `ensure_weth.wrap.sign`: Transaction signing
- `ensure_weth.wrap.sent`: Transaction broadcast
- `ensure_weth.wrap.confirmed`: Transaction confirmed
- `ensure_weth.wrap.pending`: Idempotent request detected
- `ensure_weth.wrap.error`: Execution errors

## Safety Controls

### Submit Mode Guards
1. **BOT_ADDRESS enforcement**: Only the configured bot address can execute wraps
2. **Signer validation**: Requires proper `SERVER_SIGNER_MODE` configuration
3. **ETH balance check**: Ensures sufficient ETH for wrap + gas (0.0003 ETH buffer)
4. **Idempotency**: Prevents duplicate transactions within 30-second window

### Environment Variables (Submit Mode)
- `BOT_ADDRESS`: Required - Address authorized to execute wraps
- `SERVER_SIGNER_MODE`: `"local"` or `"webhook"`
- `BOT_PRIVATE_KEY`: Required if `SERVER_SIGNER_MODE=local`
- `SIGNER_WEBHOOK_URL`: Required if `SERVER_SIGNER_MODE=webhook`
- `SIGNER_WEBHOOK_AUTH`: Required if `SERVER_SIGNER_MODE=webhook`

## Example Usage

### Plan Mode (Read-Only)
```javascript
const response = await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/wallet-ensure-weth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'plan',
    owner: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    minWethNeededWei: '1000000000000000' // 0.001 WETH
  })
});

const result = await response.json();
console.log(result);
```

### Submit Mode (Requires Configuration)
```javascript
const response = await fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/wallet-ensure-weth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'submit',
    owner: process.env.BOT_ADDRESS,
    minWethNeededWei: '1000000000000000', // 0.001 WETH
    maxWaitMs: 10000
  })
});

const result = await response.json();
if (result.ok && result.txHash) {
  console.log('Wrap executed:', result.txHash);
}
```

## Test Coverage
Run comprehensive tests with:
```javascript
fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/test-preflight-weth', {
  method: 'POST'
}).then(r => r.json()).then(console.log);
```

Tests include:
- ✅ Plan-only with sufficient WETH
- ✅ Plan-only with wrap needed
- ✅ Submit mode policy enforcement
- ✅ Legacy field backward compatibility
