# ScalpSmart Architecture Documentation

> **FREEZE DATE**: 2026-02-02  
> **STATUS**: Canonical reference for the current system state  
> **PURPOSE**: Prevent architecture regressions and enable debugability

This document describes the **current production state** of the ScalpSmart trading system. It is not aspirational—it documents what the code actually does.

---

## Table of Contents

1. [High-Level Execution Model](#1-high-level-execution-model)
2. [Execution Paths](#2-execution-paths)
3. [Execution-Class Rules (CRITICAL)](#3-execution-class-rules-critical)
4. [Edge Function Responsibilities](#4-edge-function-responsibilities)
5. [Flag & Config Glossary](#5-flag--config-glossary)
6. [Known Failure Modes (Post-Mortem)](#6-known-failure-modes-post-mortem)
7. ["Do NOT Do This" Section](#7-do-not-do-this-section)
8. [Future Placeholders](#8-future-placeholders)

---

## 1. High-Level Execution Model

### 1.1 Wallet Architecture

The system operates a **CUSTODIAL EXCHANGE MODEL**:

| Wallet Type | Purpose | Environment Variable | On-Chain Role |
|-------------|---------|---------------------|---------------|
| **System Wallet (BOT_ADDRESS)** | Executes ALL real trades | `BOT_ADDRESS`, `BOT_PRIVATE_KEY` | Holds funds, signs swaps |
| **User Deposit Wallet** | Deposit/audit only | Stored in `execution_wallets` table | Receives deposits, never trades |

**Key Invariants:**

1. **All real trades execute from `BOT_ADDRESS`** — never from user wallets
2. **User wallets exist for deposit and audit** — their on-chain balance does NOT restrict trading
3. **Database ledger (`mock_trades`) is the source of truth** for user balances, not on-chain wallet balances
4. **Withdrawals** move funds FROM system wallet TO external addresses

### 1.2 Execution Modes

| Mode | `execution_target` | Where Trades Execute | Ledger Table |
|------|-------------------|---------------------|--------------|
| **MOCK** | `'MOCK'` | Simulated (no blockchain) | `mock_trades` with `is_test_mode=true` |
| **REAL** | `'REAL'` | Base mainnet via BOT_ADDRESS | `mock_trades` with `is_test_mode=false` |

### 1.3 Trade Flow Overview

```
┌─────────────────┐      ┌─────────────────────────┐      ┌────────────────────┐
│   Entry Point   │ ──▶  │ trading-decision-       │ ──▶  │ onchain-sign-and-  │
│ (UI, Engine,    │      │ coordinator             │      │ send               │
│  Manual)        │      │ (routing + gates)       │      │ (build+sign+submit)│
└─────────────────┘      └─────────────────────────┘      └─────────────────────┘
                                                                    │
                                                                    ▼
                         ┌─────────────────────────┐      ┌────────────────────┐
                         │ mock_trades             │ ◀──  │ onchain-receipts   │
                         │ (unified ledger)        │      │ (receipt decode +  │
                         └─────────────────────────┘      │  ledger insert)    │
                                                          └────────────────────┘
```

---

## 2. Execution Paths

### 2.1 Manual Trade (Regular User)

**Entry Point:** `ManualTradeCard.tsx` with `isSystemOperator=false`

**Flow:**
1. UI calls `trading-decision-coordinator` with `source='manual'`, `force=true`
2. Coordinator checks for user's execution wallet in `execution_wallets` table
3. If wallet exists + active → routes to mock ledger insert (force override path)
4. If no wallet → mock trade only (paper trading)

**DB Tables Written:**
- `mock_trades` (with `is_test_mode=true`, `execution_source='mock_engine'`)
- `decision_events` (audit trail)

**Invariants Enforced:**
- FIFO coverage check for SELLs (must have matching BUYs)
- Strategy-linked accounting

---

### 2.2 Manual Trade (System Operator)

**Entry Point:** `ManualTradeCard.tsx` with `isSystemOperator=true`

**Identification:** `intent.source === 'manual'` AND `intent.metadata.system_operator_mode === true`

**Flow:**
1. UI calls `trading-decision-coordinator` with:
   - `source='manual'`
   - `metadata.system_operator_mode=true`
   - `force=false` (NOT set for system operator)
2. Coordinator detects system operator mode at **TOP** of entry logic (line ~2010)
3. **SHORT-CIRCUITS** all other paths (mock, force, manual override)
4. Calls `onchain-sign-and-send` directly with `BOT_ADDRESS` as taker
5. `onchain-sign-and-send` internally calls `onchain-execute` in build mode
6. `onchain-execute` fetches 0x quote, signs Permit2 EIP-712, builds transaction
7. `onchain-sign-and-send` signs transaction via `LocalSigner`
8. Transaction broadcast to Base mainnet
9. `onchain-receipts` polls for receipt, decodes logs, inserts to ledger

**DB Tables Written:**
- `trades` (intermediate state tracking)
- `trade_events` (execution lifecycle)
- `mock_trades` (final ledger with `is_test_mode=false`, `is_system_operator=true`)
- `decision_events` (audit trail)

**Invariants Enforced:**
- **No strategy, coverage, FIFO, or risk gates** — system operator bypasses all business logic gates
- Still subject to: chain validity, receipt decoding, and fail-closed execution
- `strategy_id = NULL` (no strategy ownership)
- P&L fields set to 0 (no accounting contamination)

---

### 2.3 Automated Trade (Future Placeholder)

**Status:** NOT IMPLEMENTED FOR REAL EXECUTION

**Current State:**
- `backend-shadow-engine` generates intents every 5 minutes
- Intents routed through `trading-decision-coordinator`
- All automated trades currently execute in MOCK mode only
- Real automated execution requires trust validation of AI decisions

**When Implemented:**
- Will use same `onchain-sign-and-send` pipeline as system operator
- Will NOT use `system_operator_mode` flag
- Will enforce all standard gates (exposure, cooldown, capital)

---

## 3. Execution-Class Rules (CRITICAL)

### 3.0 Single Source of Truth Rule

```
┌─────────────────────────────────────────────────────────────────┐
│              SINGLE SOURCE OF TRUTH HIERARCHY                   │
├─────────────────────────────────────────────────────────────────┤
│ 1. Intent / Coordinator data  →  ADVISORY (can be overridden)  │
│ 2. trades table               →  TRANSPORT (intermediate state)│
│ 3. mock_trades table          →  AUTHORITATIVE LEDGER          │
│ 4. Database triggers          →  ENFORCE FINAL INVARIANTS      │
├─────────────────────────────────────────────────────────────────┤
│ When in doubt: the ledger (mock_trades) wins.                   │
│ Triggers are the last line of defense.                          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 The `is_system_operator` Column

**Purpose:** Marks trades that bypass all strategy/FIFO accounting

**Location Written:**
- `onchain-receipts/index.ts` line ~559: `is_system_operator: isSystemOperator`
- Value derived from `trades.is_system_operator` column (transport layer)

**Location Read:**
- `mt_on_sell_snapshot` database trigger
- Trigger uses **column value only**, never JSON metadata

### 3.2 Ledger Invariants

```
┌─────────────────────────────────────────────────────────────────┐
│                    CRITICAL INVARIANTS                          │
├─────────────────────────────────────────────────────────────────┤
│ is_system_operator = true  ⟹  strategy_id = NULL               │
│ is_system_operator = false ⟹  strategy_id NOT NULL             │
│                                                                 │
│ is_system_operator = true  ⟹  FIFO bypass in trigger           │
│ is_system_operator = false ⟹  FIFO enforced by trigger         │
│                                                                 │
│ is_system_operator = true  ⟹  realized_pnl = 0                 │
│ is_system_operator = false ⟹  realized_pnl computed from BUYs  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Where `is_system_operator` is Propagated

| Step | Component | Source |
|------|-----------|--------|
| 1 | `ManualTradeCard.tsx` | Set via `isSystemOperator` prop |
| 2 | `trading-decision-coordinator` | Read from `intent.metadata.system_operator_mode` |
| 3 | `onchain-sign-and-send` | Passed in request body |
| 4 | `onchain-execute` | Passed through to preflight (auto-wrap policy) |
| 5 | `trades` table | Stored in `is_system_operator` column |
| 6 | `onchain-receipts` | Read from `trade.is_system_operator` |
| 7 | `mock_trades` table | Written as `is_system_operator` column |
| 8 | `mt_on_sell_snapshot` trigger | Read from column, NOT from JSON |

---

## 4. Edge Function Responsibilities

### 4.1 `trading-decision-coordinator`

**File:** `supabase/functions/trading-decision-coordinator/index.ts`

**What It Does:**
- Routes all trade intents (manual, automated, pool exit)
- Enforces safety gates for non-system-operator trades
- Dispatches to appropriate execution path

**What It MUST NOT Do:**
- Build transactions
- Sign transactions
- Broadcast to blockchain
- Mutate txPayload objects

**Assumptions:**
- `BOT_ADDRESS` environment variable is set for system operator mode
- Supabase service role has write access to `decision_events`

**Critical Code Path (System Operator):**
```typescript
// Line ~2010 - MUST be checked FIRST
if (intent.source === "manual" && intent.metadata?.system_operator_mode === true) {
  // SHORT-CIRCUIT: Direct to onchain-sign-and-send
  // DO NOT enter mock/force/manual paths below
}
```

---

### 4.2 `onchain-execute`

**File:** `supabase/functions/onchain-execute/index.ts`

**What It Does:**
- Fetches 0x quotes for BUY/SELL
- Signs Permit2 EIP-712 data from quote response
- Appends Permit2 signature to transaction calldata
- Builds transaction payload (txPayload)
- Writes to `trades` table with status='built'

**What It MUST NOT Do:**
- Sign the final transaction (that's signer.ts)
- Broadcast to blockchain
- Insert into `mock_trades` ledger

**Assumptions:**
- `BOT_PRIVATE_KEY` is available for Permit2 signing
- 0x API key is configured (`ZEROEX_API_KEY`)
- WETH balance is sufficient (or auto-wrap enabled)

**Critical Code Path (Permit2):**
```typescript
// Line ~930+ - Permit2 signature from quote
if (quoteData.raw?.permit2?.eip712) {
  const permit2Signature = await account.signTypedData({ domain, types, primaryType, message });
  // Append to calldata: <original_data><32-byte length><signature>
  txData = concat([tx.data, signatureLengthHex, permit2Signature]);
}
```

---

### 4.3 `onchain-sign-and-send`

**File:** `supabase/functions/onchain-sign-and-send/index.ts`

**What It Does:**
- Single entry point for all on-chain execution
- Internally calls `onchain-execute` in build mode (if raw params provided)
- Signs transaction via `getSigner()` (LocalSigner or WebhookSigner)
- Broadcasts to Base mainnet via RPC
- Updates `trades` table to status='submitted'

**What It MUST NOT Do:**
- Modify txPayload.data content
- Skip transaction signing
- Use any wallet other than BOT_ADDRESS

**Assumptions:**
- `LocalSigner` mode: `BOT_PRIVATE_KEY`, `BOT_ADDRESS`, `SERVER_SIGNER_LOCAL=true`
- `WebhookSigner` mode: `SIGNER_WEBHOOK_URL`, `SIGNER_WEBHOOK_AUTH`
- `RPC_URL_8453` is configured for Base mainnet

---

### 4.4 `onchain-receipts`

**File:** `supabase/functions/onchain-receipts/index.ts`

**What It Does:**
- Polls RPC for transaction receipt
- Decodes ERC-20 Transfer logs to extract actual fill values
- Validates receipt completeness (fail-closed)
- Inserts confirmed trade into `mock_trades` with Receipt-as-Truth

**What It MUST NOT Do:**
- Use intent values for amount/price/total_value
- Use coordinator estimates
- Insert with `execution_confirmed=true` if decode fails
- Infer `is_system_operator` from JSON metadata

**Assumptions:**
- `is_system_operator` column exists on `trades` table
- Trade economics are extractable from ERC-20 Transfer logs
- Known tokens are in `KNOWN_TOKENS` map

**Critical Invariant:**
```typescript
// Line ~542 - ONLY source of truth
const isSystemOperator = is_system_operator === true;
// Line ~550 - Invariant enforcement
strategy_id: isSystemOperator ? null : strategy_id,
```

---

### 4.5 `wallet-ensure-weth`

**File:** `supabase/functions/wallet-ensure-weth/index.ts`

**What It Does:**
- Checks WETH balance for sell orders
- Optionally auto-wraps ETH to WETH if policy allows

**Auto-Wrap Policy:**
- Enabled if `ENABLE_AUTO_WRAP=true` OR `system_operator_mode=true`
- System operator trades always auto-wrap for seamless execution

---

## 5. Flag & Config Glossary

### 5.1 Authoritative Flags

| Flag | Location | Meaning | Status |
|------|----------|---------|--------|
| `is_system_operator` | `mock_trades` column | Trade bypasses all strategy accounting | **AUTHORITATIVE** |
| `is_test_mode` | `mock_trades` column | MOCK (true) vs REAL (false) trade | **AUTHORITATIVE** |
| `execution_target` | `trading_strategies` table | Strategy's target mode | **AUTHORITATIVE** |
| `execution_confirmed` | `mock_trades` column | Receipt fully decoded | **AUTHORITATIVE** |
| `execution_source` | `mock_trades` column | 'mock_engine' or 'onchain' | **AUTHORITATIVE** |

### 5.2 Transport-Only Flags

| Flag | Location | Meaning | Status |
|------|----------|---------|--------|
| `system_operator_mode` | `intent.metadata` | Coordinator routing hint | **TRANSPORT ONLY** |
| `force` | `intent.metadata` | Mock force override | **TRANSPORT ONLY** |

### 5.3 Deprecated Flags

| Flag | Location | Meaning | Status |
|------|----------|---------|--------|
| `intent.source === 'system_operator'` | Coordinator | Old routing method | **DEPRECATED** — use metadata flag |

### 5.4 Environment Variables

| Variable | Function | Required For |
|----------|----------|--------------|
| `BOT_ADDRESS` | System wallet address | All real trades |
| `BOT_PRIVATE_KEY` | System wallet signer | All real trades |
| `RPC_URL_8453` | Base mainnet RPC | All real trades |
| `ZEROEX_API_KEY` | 0x quote API | All real trades |
| `SERVER_SIGNER_MODE` | 'local' or 'webhook' | Signing mode selection |
| `SERVER_SIGNER_LOCAL` | 'true' to enable local | Local signing |
| `EXECUTION_DRY_RUN` | 'false' for live | Safety override |
| `ENABLE_AUTO_WRAP` | 'true' for auto-wrap | ETH→WETH wrapping |

---

## 6. Known Failure Modes (Post-Mortem)

### 6.1 The SELL Coverage Bug

**What Happened:**
System operator SELL trades were failing with "FIFO coverage" errors even though they should bypass all accounting.

**Root Cause:**
The `mt_on_sell_snapshot` database trigger was reading `is_system_operator` from JSON metadata instead of the column. JSON payloads were being overwritten/lost in the execution pipeline, causing the trigger to see `null` and enforce FIFO.

**Why It Cannot Happen Anymore:**
1. `is_system_operator` is now a **first-class column** on `mock_trades`
2. Trigger reads **column value only**: `NEW.is_system_operator = true`
3. Column is written explicitly in `onchain-receipts`: `is_system_operator: isSystemOperator`
4. Value is propagated through `trades.is_system_operator` column (not JSON)

**Invariant That Prevents Recurrence:**
```sql
-- Trigger must check column, never JSON
IF NEW.is_system_operator = true THEN
  -- Bypass all FIFO, set P&L to 0
END IF;
```

### 6.2 The Calldata Disappearing Bug

**What Happened:**
Transactions were being broadcast with empty/zeroed calldata, causing on-chain reverts.

**Root Cause:**
The 0x API v2 requires Permit2 signatures to be appended to transaction calldata. Without this signature, the Settler contract cannot pull tokens and reverts immediately.

**Why It Cannot Happen Anymore:**
1. `onchain-execute` now checks for `quoteData.raw.permit2.eip712`
2. Signs EIP-712 typed data with BOT_PRIVATE_KEY
3. Appends signature to calldata in correct format: `<data><length><sig>`

**Invariant That Prevents Recurrence:**
```typescript
// onchain-execute line ~930+
if (quoteData.raw?.permit2?.eip712) {
  // MUST sign and append - transaction will revert without this
}
```

### 6.3 The Flag Conflict Bug

**What Happened:**
System operator trades were being caught by the "manual force override" path instead of the system operator path, causing execution failures.

**Root Cause:**
Both `system_operator_mode: true` AND `force: true` were being set. The `force` check came first in the code and routed to mock execution.

**Why It Cannot Happen Anymore:**
1. `ManualTradeCard.tsx` now sets `force: !isSystemOperator`
2. System operator trades have `force: false`
3. System operator check is at **TOP** of coordinator (line ~2010)
4. Short-circuits before any force/mock checks

---

## 7. "Do NOT Do This" Section

### 7.1 Absolute Prohibitions

❌ **Do NOT infer execution class from JSON metadata in triggers**
```sql
-- WRONG: JSON can be lost/overwritten
IF NEW.metadata->>'system_operator_mode' = 'true' THEN

-- CORRECT: Use the column
IF NEW.is_system_operator = true THEN
```

❌ **Do NOT let AI execute real trades without human approval**
```typescript
// WRONG: Automated trades going directly to on-chain
if (intent.source === 'automated') {
  await executeRealTrade(intent);
}

// CORRECT: Automated trades are MOCK only until trust is established
```

❌ **Do NOT bypass ledger invariants**
```typescript
// WRONG: Allowing strategy_id with system operator
{
  is_system_operator: true,
  strategy_id: someStrategyId  // VIOLATION
}

// CORRECT: System operator trades have no strategy
{
  is_system_operator: true,
  strategy_id: null
}
```

❌ **Do NOT use intent/coordinator values for real trade economics**
```typescript
// WRONG: Using quoted price for ledger
amount: intent.qtySuggested,
price: quoteData.price,

// CORRECT: Only use values from receipt decode
amount: decodedTrade.filledAmount,
price: decodedTrade.executedPrice,
```

❌ **Do NOT set both system_operator_mode and force**
```typescript
// WRONG: Flag conflict
metadata: {
  system_operator_mode: true,
  force: true,  // Will trigger wrong path
}

// CORRECT: Mutually exclusive
metadata: {
  system_operator_mode: true,
  force: false,
}
```

### 7.2 Architectural Boundaries

| Component | CAN | CANNOT |
|-----------|-----|--------|
| Coordinator | Route intents, enforce gates | Build/sign/broadcast transactions |
| onchain-execute | Build txPayload, sign Permit2 | Sign final transaction, broadcast |
| onchain-sign-and-send | Sign transaction, broadcast | Modify calldata content |
| onchain-receipts | Decode logs, insert to ledger | Use non-receipt values |
| UI Components | Set intent flags | Execute trades directly |

---

## 8. Future Placeholders

### 8.1 ExecutionClass Enum (Phase 1)

**Planned:** Collapse all execution class flags into structured enums.

> ⚠️ **Design Note:** The original proposal mixed two orthogonal dimensions (environment × authority), which caused semantic overload. The enum will likely be split into:
> - `execution_class`: `USER_MANUAL` | `USER_AUTOMATED` | `SYSTEM_OPERATOR`
> - `execution_target`: `MOCK` | `REAL`
> 
> This separation prevents the entanglement that caused earlier bugs.

**Status:** NOT IMPLEMENTED — requires migration of existing data

### 8.2 Automated Real Execution (Phase 2+)

**Planned:** Enable real execution for AI-generated intents after trust validation.

**Prerequisites:**
- Confidence threshold calibration
- Human-in-the-loop approval for high-value trades
- Circuit breakers tested in production

**Status:** NOT IMPLEMENTED — all automated trades remain MOCK

---

## 9. Minimal Observability Requirements

Given the complexity of the asynchronous execution pipeline, the following alerts/monitors are **required** before enabling real automated trading:

### 9.1 Critical Alerts (Must Have)

| Alert | Condition | Why |
|-------|-----------|-----|
| **Receipt decode failure** | `execution_confirmed = false` after 10 min | Trade executed but not recorded correctly |
| **Trigger exception** | Any error in `mt_on_sell_snapshot` | FIFO/coverage logic broken |
| **trades → mock_trades mismatch** | Count divergence over 1 hour | Receipts not processing |
| **Permit2 signature failure** | Any `permit2.eip712` present but signature missing | Transactions will revert |
| **Transaction revert rate** | >20% of broadcast txs revert | Systemic execution issue |

### 9.2 Health Indicators

| Metric | Healthy State |
|--------|---------------|
| `trades` with `status='submitted'` older than 5 min | 0 |
| `mock_trades` with `execution_confirmed=false` older than 10 min | 0 |
| Time since last successful real trade | < 24h (when trading enabled) |
| Circuit breaker trip count (24h) | < 3 |

### 9.3 Debugging Checklist

When a trade fails, check in order:
1. **Edge function logs** — Did the function execute?
2. **trades table** — Is there a record? What status?
3. **tx_hash on BaseScan** — Did it broadcast? Did it revert?
4. **mock_trades table** — Did the receipt processor run?
5. **Trigger logs** — Did `mt_on_sell_snapshot` error?

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-02-02 | System | Initial freeze after SELL coverage bug fix |

---

*This document is the canonical reference. Any code that violates these invariants is a bug.*
