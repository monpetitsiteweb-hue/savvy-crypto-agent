# AI Agent Orchestration - Project Status Brief

## 1. Current Architecture & Components

### Supabase Schema (Key Tables)
```
├── mock_trades                    # Trade records (mock & live)
├── trading_strategies             # Strategy configs + unified_config
├── trade_decisions_log            # Decision audit trail
├── execution_holds                # Symbol quarantine/holds
├── execution_circuit_breakers     # Risk circuit breakers
├── execution_quality_log          # Execution metrics
├── coin_pool_states               # Pool exit state tracking
├── calibration_metrics            # AI calibration data
├── decision_events                # Decision metadata
├── decision_outcomes              # Outcome evaluations
└── price_snapshots                # Market price cache
```

### Edge Functions (supabase/functions/)
```
trading-decision-coordinator/index.ts  # Central decision router
├── Unified conflict detection (HOLD/BUY/SELL)
├── Precedence: POOL_EXIT > HARD_RISK > intelligent > automated
├── Min hold period (120s), cooldown (30s) enforcement
└── Fast-path for manual/mock/force intents

onchain-quote/index.ts                 # Multi-provider quote aggregator
├── Providers: 0x v2 (Permit2), 1inch, CoW, Uniswap
├── Humanized price calculation
├── Gas cost estimation
└── Returns effectiveBpsCost for MetaRouter

onchain-execute/index.ts               # Trade execution engine
├── Mode: build (unsigned tx) | send (broadcast)
├── Preflight checks: WETH balance, Permit2 allowance
├── Trade record creation (with persist guard)
├── Transaction simulation & broadcast
└── Status: pending → built → submitted → confirmed

wallet-permit2-status/index.ts         # Permit2 allowance checker
├── Checks ERC-20 Permit2 allowance
├── Returns EIP-712 typedData if approval needed
└── Used in preflight checks

wallet-permit2-submit/index.ts         # Permit2 transaction submitter
├── Accepts user's EIP-712 signature
├── Server signs & broadcasts Permit2.permit()
└── Enables gasless token approvals

wallet-ensure-weth/index.ts            # WETH wrapper helper
└── Checks/returns WETH balance for ETH→WETH wraps
```

### GitHub Workflows (.github/workflows/)
```
calibration-aggregator-daily.yml       # Daily calibration metrics
features-refresh-daily.yml             # Daily feature engineering
ohlcv-backfill-daily.yml              # Historical OHLCV backfill
run-calibration-aggregator.yml        # Manual calibration trigger
deploy-dev.yml                        # Deploy to dev branch
deploy-prod.yml                       # Deploy to main branch
```

### Secrets (Deno.env)
```
# Supabase
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

# RPC Endpoints
RPC_URL_1 (Ethereum), RPC_URL_8453 (Base), RPC_URL_42161 (Arbitrum)

# API Keys
ZEROEX_API_KEY, ONEINCH_API_KEY, COINBASE_API_KEY, COINBASE_API_SECRET

# Signer Infrastructure
SERVER_SIGNER_MODE (local|webhook)
BOT_PRIVATE_KEY, BOT_ADDRESS (local mode)
SIGNER_WEBHOOK_URL, SIGNER_WEBHOOK_AUTH (webhook mode)

# Limits
MAX_TX_VALUE_WEI
```

## 2. Current Run/Test Pipeline

### **NO ORCHESTRATOR PIPELINE FOUND**
The codebase does **not** contain:
- `orchestrator-run` function
- `/start-build` or `/complete-build` endpoints
- GitHub Issue-driven workflow automation
- Lovable brief generation integration

### Actual Trade Flow (Live System)
```
1. Intent Generation
   ├── Source: automated | intelligent | pool | manual | news | whale
   └── Client → POST /trading-decision-coordinator

2. Coordinator Decision
   ├── File: supabase/functions/trading-decision-coordinator/index.ts
   ├── Fast-path: manual + force → direct mock execution
   ├── UD_MODE=OFF → executeTradeDirectly()
   └── UD_MODE=ON → conflict detection → precedence → execution

3. Quote Aggregation (if approved)
   ├── File: supabase/functions/onchain-quote/index.ts
   ├── Parallel fetch: 0x, 1inch, CoW, Uniswap
   ├── MetaRouter: src/execution/MetaRouter.ts
   └── bestQuote(providers, timeout=600ms, tieBps=2)

4. Execution (build mode)
   ├── File: supabase/functions/onchain-execute/index.ts
   ├── Preflight: WETH balance + Permit2 allowance
   ├── Quote → transaction payload → simulate
   ├── Insert into 'trades' table (if persist !== false)
   └── Return: { tradeId, tx_payload, status: 'built' }

5. User Signing (manual - BLOCKER)
   ├── File: public/sign-permit2.html (EIP-712 signer)
   ├── MetaMask signs transaction
   └── User provides signedTx

6. Broadcast (send mode)
   ├── POST /onchain-execute { tradeId, signedTx }
   ├── Broadcast via RPC
   └── Status: submitted → confirmed

Logs: Edge function logs in Supabase dashboard
```

## 3. What Works (Tested & Deployed)

### ✅ Mock Trading (Test Mode)
```typescript
// File: supabase/functions/trading-decision-coordinator/index.ts
// Lines: 157-270 (fast-path for mock SELLs)

- FIFO P&L calculation from buyTrades
- Snapshot fields: original_purchase_*, exit_value, realized_pnl
- 5s symbol quarantine after manual SELL
- Works: Manual sells with force=true, mode='mock'
```

### ✅ Unified Decisions System
```typescript
// File: supabase/functions/trading-decision-coordinator/index.ts
// Lines: 467-700+ (conflict detection)

- Min hold period: 120s (anti-flip-flop)
- Cooldown between opposite actions: 30s
- Precedence hierarchy: POOL_EXIT > HARD_RISK > intelligent > automated
- Reason codes: 'min_hold_period_not_met', 'blocked_by_cooldown', 'blocked_by_precedence:POOL_EXIT'
- Decision logging: trade_decisions_log table
- Works: BUY/SELL conflict prevention (see test_summary_final.md)
```

### ✅ On-Chain Quote Aggregation
```typescript
// File: supabase/functions/onchain-quote/index.ts
// MetaRouter: src/execution/MetaRouter.ts

- Providers: 0x v2 (Permit2 endpoint), 1inch, CoW, Uniswap
- Parallel fetch with 600ms timeout
- Tie-breaking: preferredOrder with 2bps tolerance
- Humanized price calculation (quote per base)
- Gas cost estimation (native → quote conversion)
- Works: Multi-provider quotes on Base/Ethereum/Arbitrum
```

### ✅ Execution Quality Tracking
```sql
-- Tables: execution_quality_log, execution_quality_metrics_24h
-- File: src/components/execution/ExecutionQualityMetrics24h.tsx

- Tracks: slippage_bps, execution_latency_ms, partial_fill_rate
- Circuit breakers: execution_circuit_breakers table
- Breaker types: MAX_SLIPPAGE_BPS, MAX_LOSS_STREAK, MAX_DAILY_LOSS
- Works: Real-time quality metrics, breaker status display
```

### ✅ Permit2 Flow (Partial)
```typescript
// Files:
//   wallet-permit2-status/index.ts    (checks allowance)
//   wallet-permit2-submit/index.ts    (broadcasts permit)
//   public/sign-permit2.html          (EIP-712 UI)

- Status check: returns typedData if approval needed
- Submit: accepts signature → signs with server → broadcasts
- Works: Permit2 approval detection & submission
- Gap: Not integrated into automated BUY flow
```

## 4. Known Gaps & Blockers

### 🚫 BLOCKER: Manual Signing Required
```
Current: User must manually sign transactions via MetaMask
File: public/sign-permit2.html (manual EIP-712 signer)

Problem:
- onchain-execute returns unsigned tx (mode=build)
- User signs in browser
- User submits signedTx (mode=send)
- Not automated for AI agent
```

### 🚫 BLOCKER: No AI Orchestration Pipeline
```
Missing Components:
- orchestrator-run edge function
- GitHub Issue intake system
- /start-build, /complete-build, /test endpoints
- Lovable brief generation
- Test result aggregation

Current State: All workflows are manual or scheduled (cron)
```

### 🚫 GAP: Incomplete On-Chain BUY Path
```typescript
// File: supabase/functions/onchain-execute/index.ts
// Lines: 360-491 (preflight checks)

Preflight checks exist:
1. WETH balance check → wallet-ensure-weth
2. Permit2 allowance → wallet-permit2-status

But:
- No automated wrap execution (ETH → WETH)
- No automated Permit2 signing
- No retry mechanism for preflight failures
- Returns 'preflight_required' → user must manually resolve
```

### 🚫 GAP: Transaction Persistence Guard
```typescript
// File: supabase/functions/onchain-execute/index.ts
// Lines: 493-520 (trade record insertion)

Recent change (per user request):
if (body.persist !== false) {
  // Insert into 'trades' table
}

Issue: If persist=false, tradeId is mocked → can't track status
```

### 🚫 GAP: Signer Infrastructure Not Documented
```
SERVER_SIGNER_MODE: 'local' | 'webhook'
File: supabase/functions/_shared/signer.ts

Local mode:
- Requires BOT_PRIVATE_KEY, BOT_ADDRESS
- Signs transactions in edge function
- Risk: Private key in environment

Webhook mode:
- Requires SIGNER_WEBHOOK_URL, SIGNER_WEBHOOK_AUTH
- External signing service (e.g., signer-service/)
- Gap: signer-service deployment not automated
```

## 5. Immediate Next Task: Automated On-Chain BUY Path

### 🎯 Goal
Enable fully automated BUY execution on Base (chain 8453) using 0x v2 Permit2 flow, without manual user intervention.

### 📋 Task Breakdown

#### Task 5.1: Automated WETH Wrapping
```typescript
File: supabase/functions/wallet-ensure-weth/index.ts (new or enhance existing)

Requirements:
1. Accept: { address, minWethNeeded }
2. Check WETH balance via RPC (balanceOf)
3. If insufficient:
   a. Calculate ETH needed (+ gas buffer)
   b. Build WETH.deposit() transaction
   c. Sign via signer infrastructure
   d. Broadcast & wait for receipt
   e. Verify new WETH balance
4. Return: { action: 'wrapped' | 'sufficient', newBalance }

Acceptance:
- Call with address=0xD41AF..., minWethNeeded=1000000000000000000
- If ETH balance >= minWethNeeded, wraps ETH → WETH
- Returns newBalance >= minWethNeeded
- Logs: 'WETH wrap successful: {txHash}'
```

#### Task 5.2: Automated Permit2 Approval
```typescript
File: supabase/functions/wallet-permit2-auto-approve/index.ts (new)

Requirements:
1. Accept: { address, token, spender, minAllowance }
2. Check allowance via wallet-permit2-status
3. If insufficient:
   a. Build EIP-712 typedData
   b. Sign via signer infrastructure (eth_signTypedData_v4)
   c. Call wallet-permit2-submit with signature
   d. Wait for permit() transaction receipt
   e. Verify new allowance
4. Return: { action: 'approved' | 'sufficient', allowance }

Acceptance:
- Call with token=WETH, spender=0x Permit2, minAllowance=1e18
- If allowance < minAllowance, signs & submits Permit2 approval
- Returns allowance >= minAllowance
- Logs: 'Permit2 approval successful: {txHash}'
```

#### Task 5.3: Integrated Preflight Resolver
```typescript
File: supabase/functions/onchain-execute/index.ts
Lines: ~176-260 (enhance runPreflight)

Requirements:
1. Modify runPreflight() to accept { autoResolve: boolean }
2. If autoResolve=true:
   a. WETH check fails → call wallet-ensure-weth with auto-wrap
   b. Permit2 check fails → call wallet-permit2-auto-approve
   c. Retry checks after resolution
3. Return null if all checks pass, structured error if unresolvable

Acceptance:
- Call onchain-execute with preflight=true, autoResolve=true
- Automatically wraps WETH if needed
- Automatically approves Permit2 if needed
- Proceeds to quote & execution without 'preflight_required' response
- Logs: 'Preflight auto-resolved: weth_wrapped=true, permit2_approved=true'
```

#### Task 5.4: Automated Transaction Signing
```typescript
File: supabase/functions/onchain-execute/index.ts
Lines: ~550-650 (enhance build/send flow)

Requirements:
1. After building unsigned tx (mode=build):
   a. If autoSign=true (new parameter):
      - Call signer infrastructure (signer.ts)
      - Sign transaction payload
      - Broadcast immediately (skip mode=send step)
   b. Update trade status: built → submitted
2. Return: { tradeId, tx_hash, status: 'submitted' }

Acceptance:
- Call onchain-execute with mode=build, autoSign=true
- Returns signed & broadcasted transaction in single call
- No manual signing step required
- Logs: 'Transaction auto-signed and submitted: {txHash}'
```

#### Task 5.5: End-to-End BUY Test
```typescript
File: test_onchain_buy_base.ts (new test script)

Requirements:
1. Scenario: BUY 0.001 ETH with USDC on Base
2. Steps:
   a. Check starting balances (ETH, WETH, USDC)
   b. Call onchain-execute with:
      - chainId: 8453
      - base: 'ETH', quote: 'USDC'
      - side: 'BUY', amount: 0.001
      - preflight: true, autoResolve: true, autoSign: true
   c. Wait for transaction confirmation
   d. Verify final balances (WETH increased by ~0.001)
3. Assert: No 'preflight_required', no manual steps

Acceptance:
- Run: deno run --allow-all test_onchain_buy_base.ts
- Completes without manual intervention
- Final WETH balance = starting + 0.001 (within slippage)
- Logs: 'E2E BUY test passed: {tradeId}, {txHash}'
```

### 📊 Acceptance Criteria Summary
1. ✅ WETH wrapping executes automatically when needed
2. ✅ Permit2 approvals execute automatically when needed
3. ✅ Transactions sign automatically (no MetaMask popup)
4. ✅ Full BUY flow completes in single API call
5. ✅ Test script runs without manual steps
6. ✅ All logs appear in Supabase edge function logs

### 📍 Where Logs Appear
```
Supabase Dashboard:
https://supabase.com/dashboard/project/fuieplftlcxdfkxyqzlt/functions/<function-name>/logs

Functions to monitor:
- onchain-execute
- onchain-quote
- wallet-ensure-weth
- wallet-permit2-status
- wallet-permit2-submit
- wallet-permit2-auto-approve (new)

Filter by:
- "Preflight auto-resolved"
- "WETH wrap successful"
- "Permit2 approval successful"
- "Transaction auto-signed"
- "E2E BUY test passed"
```

---

**Status**: 5 tasks defined, 0 implemented. Estimated 4-6 hours for full automation.
**Blocker**: Signer infrastructure must be deployed & tested before automation.
**Next**: Implement Task 5.1 (WETH wrapping) as proof-of-concept.
