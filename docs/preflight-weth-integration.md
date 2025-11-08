# Preflight WETH Integration for BUY Path

## Overview

The BUY execution path on Base (chainId 8453) now includes automatic WETH balance validation during preflight checks. When a BUY order requires selling ETH (which is wrapped to WETH for on-chain execution), the system checks if sufficient WETH is available.

## Configuration

### Environment Variable

- **`ENABLE_AUTO_WRAP`**: Set to `'true'` to enable automatic WETH wrapping when policy permits.
  - **Default**: `false` (read-only mode)
  - **Read-only mode**: Returns a "wrap-needed" signal without executing on-chain transactions
  - **Auto-wrap mode**: Attempts to execute the wrap transaction if all policy checks pass

## Behavior by Mode

### Read-Only Mode (`ENABLE_AUTO_WRAP` not set or `false`)

When insufficient WETH is detected:
```json
{
  "status": "preflight_required",
  "reason": "insufficient_weth",
  "wrapPlan": {
    "deficitWei": "100000000000000000",
    "deficitHuman": "0.1 ETH",
    "currentWethBalance": "0",
    "minWethNeeded": "100000000000000000"
  },
  "note": "Wrap WETH manually, then re-run."
}
```

### Auto-Wrap Mode (`ENABLE_AUTO_WRAP=true`)

The system attempts to wrap ETH automatically if:
1. The requesting address matches `BOT_ADDRESS` (security constraint)
2. Sufficient ETH balance exists to cover wrap amount + gas
3. No concurrent wrap transaction is pending (idempotency check)

**Success response:**
```json
{
  "action": "wrapped",
  "txHash": "0x...",
  "newWethBalance": "100000000000000000",
  "message": "Successfully wrapped ETH to WETH"
}
```

**Policy blocked (e.g., address mismatch):**
```json
{
  "status": "preflight_required",
  "reason": "insufficient_weth",
  "wrapPlan": {
    "error": "Auto-wrap blocked by policy",
    "detail": "Address mismatch or policy not satisfied"
  },
  "note": "Manual WETH wrap required or adjust policy."
}
```

## Integration Points

### 1. onchain-execute Preflight

Location: `supabase/functions/onchain-execute/index.ts` → `runPreflight()`

- **Triggered**: When `preflight !== false` and `taker` address is provided
- **Check order**: WETH balance → Permit2 allowance
- **Chain support**: Base (8453) only

### 2. wallet-ensure-weth Function

Location: `supabase/functions/wallet-ensure-weth/index.ts`

- **Input**: `{ address, minWethNeeded, autoWrap }`
- **Output**: `{ action: 'none' | 'wrap' | 'wrapped', ... }`

## Logging

All preflight decisions are logged with structured keys:

- `preflight.config: autoWrapEnabled=true|false` - Initial policy check
- `preflight.wrap.needed` - Insufficient WETH detected
- `preflight.wrap.blocked` - Auto-wrap blocked by policy
- `preflight.wrap.executed` - Auto-wrap completed successfully
- `preflight.wrap.sufficient` - WETH balance already sufficient

## Security Constraints

1. **Address validation**: Auto-wrap only executes for `BOT_ADDRESS`
2. **Idempotency**: Prevents duplicate wrap transactions within a time window
3. **Balance checks**: Validates ETH balance before attempting wrap
4. **Explicit opt-in**: Requires environment variable to enable auto-wrap

## Testing

### Test Scenarios

#### 1. Read-Only Check (Sufficient WETH)
```javascript
fetch('https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/onchain-execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chainId: 8453,
    base: 'ETH',
    quote: 'USDC',
    side: 'BUY',
    amount: 10, // 10 USDC
    slippageBps: 50,
    taker: '0x2C779B78175d4069CcF2C8d79268957F5a06CF68',
    mode: 'build'
  })
});
```

Expected: Proceeds to Permit2 check if WETH ≥ required.

#### 2. Read-Only Check (Insufficient WETH)
Same as above, but with `amount: 100000` (very large).

Expected: Returns `status: 'preflight_required', reason: 'insufficient_weth'`.

#### 3. Auto-Wrap Enabled (Policy Check)
Set `ENABLE_AUTO_WRAP=true` environment variable, then run same test.

Expected:
- If `taker` matches `BOT_ADDRESS`: Executes wrap, returns success
- If `taker` does not match: Returns policy blocked error

### Manual Testing

```bash
# Enable auto-wrap
# Set ENABLE_AUTO_WRAP=true in Supabase Dashboard → Edge Functions → Secrets

# Test BUY with insufficient WETH
curl -X POST https://fuieplftlcxdfkxyqzlt.supabase.co/functions/v1/onchain-execute \
  -H "Content-Type: application/json" \
  -d '{
    "chainId": 8453,
    "base": "ETH",
    "quote": "USDC",
    "side": "BUY",
    "amount": 10,
    "slippageBps": 50,
    "taker": "YOUR_BOT_ADDRESS",
    "mode": "build"
  }'
```

## Migration Path

### Phase 1 (Current): Read-Only
- Default behavior: returns wrap-needed signals
- No on-chain writes during preflight
- UI/engine can prompt user or schedule wrap

### Phase 2: Opt-In Auto-Wrap
- Set `ENABLE_AUTO_WRAP=true` for bot address
- System executes wraps automatically when policy permits
- Full logging and idempotency controls

### Phase 3: User-Facing Integration
- UI prompts for wrap approval
- Tracks pending wrap transactions
- Shows wrap status in execution flow

## Error Taxonomy

| Error | Reason | Resolution |
|-------|--------|------------|
| `insufficient_weth` | WETH balance < required | Wrap ETH to WETH or increase WETH balance |
| `policy_blocked` | Address does not match `BOT_ADDRESS` | Use authorized address or manual wrap |
| `insufficient_eth` | ETH balance < wrap amount + gas | Add more ETH to wallet |
| `wrap_pending` | Concurrent wrap detected | Wait for pending wrap to complete |

## Design Decisions

1. **Default to read-only**: Prevents unexpected on-chain writes
2. **Explicit opt-in**: Requires environment variable for auto-wrap
3. **Address-based policy**: Only bot address can auto-wrap (security)
4. **Idempotency window**: Prevents duplicate wrap transactions
5. **Structured errors**: Clear signals for UI/engine to handle

## Future Enhancements

- [ ] Support for user-authorized auto-wrap (beyond bot address)
- [ ] Retry logic for failed wrap transactions
- [ ] Gas price estimation and user approval
- [ ] Multi-signature support for high-value wraps
- [ ] Wrap transaction status polling
- [ ] Integration with UI for wrap approval flows
