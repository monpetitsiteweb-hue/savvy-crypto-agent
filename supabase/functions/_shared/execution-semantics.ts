// =============================================================================
// PHASE 2: CANONICAL EXECUTION SEMANTICS
// =============================================================================
// This module defines the three orthogonal dimensions of execution classification:
//   1. ExecutionAuthority - WHO is executing (USER vs SYSTEM)
//   2. ExecutionIntent    - HOW it was triggered (MANUAL vs AUTOMATED)
//   3. ExecutionTarget    - WHERE it executes (MOCK vs REAL)
//
// The deriveExecutionClass() function is the SINGLE POINT OF TRUTH for interpreting
// legacy flags. All downstream logic MUST derive from this classification, not
// from the raw flags themselves.
//
// LEGACY FLAGS (interpreted only here, deprecated for direct use):
//   - source: 'manual' | 'automated' | 'intelligent' | 'pool' | 'news' | 'whale'
//   - system_operator_mode: boolean (in metadata)
//   - force: boolean (in metadata) - debugging override for mock trades
//   - execution_wallet_id: string (in metadata) - presence indicates REAL intent
//   - is_test_mode: boolean (in metadata) - DEPRECATED, use execution_target
//   - execution_target: 'MOCK' | 'REAL' (from strategy config)
// =============================================================================

/**
 * ExecutionAuthority: WHO is executing the trade
 * - USER: A human user initiated this (manual trades, user-triggered automated)
 * - SYSTEM: The system/operator initiated this (administrative, bot operations)
 */
export type ExecutionAuthority = 'USER' | 'SYSTEM';

/**
 * ExecutionIntent: HOW the trade was triggered
 * - MANUAL: Explicitly triggered by a human action (UI button, operator panel)
 * - AUTOMATED: Triggered by system logic (signals, engine, pool rules)
 */
export type ExecutionIntent = 'MANUAL' | 'AUTOMATED';

/**
 * ExecutionTarget: WHERE the trade executes
 * - MOCK: Simulated execution (mock_trades ledger, no blockchain)
 * - REAL: Real execution (on-chain, real_trades shadow ledger)
 */
export type ExecutionTarget = 'MOCK' | 'REAL';

/**
 * The complete execution classification for a trade intent.
 * This is the ONLY structure that downstream logic should depend on.
 */
export interface ExecutionClass {
  authority: ExecutionAuthority;
  intent: ExecutionIntent;
  target: ExecutionTarget;
  
  // Derived convenience flags (computed from the above)
  isSystemOperator: boolean;
  isMockExecution: boolean;
  isManualTrade: boolean;
  
  // Debug info: which legacy flags were used to derive this
  _derivedFrom: {
    source: string;
    system_operator_mode: boolean;
    force: boolean;
    has_execution_wallet_id: boolean;
    strategy_execution_target: string;
  };
}

/**
 * Input structure for deriveExecutionClass.
 * This captures all the legacy flags that were previously scattered across the codebase.
 */
export interface ExecutionClassInput {
  /** The source field from TradeIntent */
  source: string;
  
  /** Metadata object from TradeIntent (may contain legacy flags) */
  metadata?: {
    system_operator_mode?: boolean;
    force?: boolean;
    execution_wallet_id?: string;
    is_test_mode?: boolean;
    [key: string]: any;
  };
  
  /** The execution_target from trading_strategies table */
  strategyExecutionTarget?: 'MOCK' | 'REAL' | string;
}

/**
 * SINGLE POINT OF TRUTH for execution classification.
 * 
 * This pure function interprets all legacy flags and produces a canonical
 * ExecutionClass. All downstream code MUST use this classification instead
 * of checking flags directly.
 * 
 * DERIVATION RULES:
 * 
 * 1. ExecutionAuthority:
 *    - SYSTEM if: source === 'manual' AND system_operator_mode === true
 *    - USER otherwise
 * 
 * 2. ExecutionIntent:
 *    - MANUAL if: source === 'manual'
 *    - AUTOMATED otherwise (intelligent, automated, pool, news, whale, etc.)
 * 
 * 3. ExecutionTarget:
 *    - REAL if: execution_wallet_id is present (explicit real intent)
 *    - REAL if: strategyExecutionTarget === 'REAL'
 *    - MOCK otherwise
 * 
 * @param input - The raw flags from intent and strategy
 * @returns ExecutionClass - The canonical classification
 */
export function deriveExecutionClass(input: ExecutionClassInput): ExecutionClass {
  const source = input.source || 'automated';
  const metadata = input.metadata || {};
  const strategyExecutionTarget = input.strategyExecutionTarget || 'MOCK';
  
  // Extract legacy flags
  const systemOperatorMode = metadata.system_operator_mode === true;
  const force = metadata.force === true;
  const hasExecutionWalletId = !!metadata.execution_wallet_id;
  
  // =========================================================================
  // DERIVATION LOGIC
  // =========================================================================
  
  // 1. AUTHORITY: SYSTEM if manual + system_operator_mode, else USER
  const authority: ExecutionAuthority = 
    (source === 'manual' && systemOperatorMode) ? 'SYSTEM' : 'USER';
  
  // 2. INTENT: MANUAL if source is 'manual', else AUTOMATED
  const intent: ExecutionIntent = 
    source === 'manual' ? 'MANUAL' : 'AUTOMATED';
  
  // 3. TARGET: REAL if wallet_id present OR strategy says REAL, else MOCK
  // Note: system_operator_mode implies REAL (uses system wallet)
  const target: ExecutionTarget = 
    (hasExecutionWalletId || strategyExecutionTarget === 'REAL' || systemOperatorMode)
      ? 'REAL'
      : 'MOCK';
  
  // =========================================================================
  // CONVENIENCE FLAGS (derived from the above, not from raw input)
  // =========================================================================
  
  const isSystemOperator = authority === 'SYSTEM';
  const isMockExecution = target === 'MOCK';
  const isManualTrade = intent === 'MANUAL';
  
  return {
    authority,
    intent,
    target,
    isSystemOperator,
    isMockExecution,
    isManualTrade,
    _derivedFrom: {
      source,
      system_operator_mode: systemOperatorMode,
      force,
      has_execution_wallet_id: hasExecutionWalletId,
      strategy_execution_target: strategyExecutionTarget,
    },
  };
}

/**
 * Log the derived execution class for diagnostics.
 * This should be called once at the coordinator boundary.
 */
export function logExecutionClass(execClass: ExecutionClass, tradeId?: string): void {
  console.log('EXECUTION_CLASS_DERIVED', {
    authority: execClass.authority,
    intent: execClass.intent,
    target: execClass.target,
    isSystemOperator: execClass.isSystemOperator,
    isMockExecution: execClass.isMockExecution,
    isManualTrade: execClass.isManualTrade,
    trade_id: tradeId || 'pending',
    _derivedFrom: execClass._derivedFrom,
  });
}

// =============================================================================
// LEGACY FLAG MAPPING DOCUMENTATION
// =============================================================================
// 
// This section documents how legacy flags map to the new execution semantics.
// These flags are now DEPRECATED for direct use - use deriveExecutionClass() instead.
//
// | Legacy Flag              | Origin                  | Maps To                    | Status      |
// |--------------------------|-------------------------|----------------------------|-------------|
// | source                   | TradeIntent.source      | ExecutionIntent            | Deprecated  |
// | system_operator_mode     | metadata                | ExecutionAuthority=SYSTEM  | Deprecated  |
// | force                    | metadata                | (debugging only)           | Deprecated  |
// | execution_wallet_id      | metadata                | ExecutionTarget=REAL       | Deprecated  |
// | is_test_mode             | metadata                | (removed, unused)          | Removed     |
// | execution_target         | strategy config         | ExecutionTarget            | Deprecated  |
//
// BEHAVIOR PARITY VERIFICATION:
// 
// Old Pattern:                              New Pattern:
// ─────────────────────────────────────────────────────────────────────────────
// source === 'manual' &&                 →  execClass.authority === 'SYSTEM'
//   system_operator_mode === true
//
// source === 'manual'                    →  execClass.intent === 'MANUAL'
//
// !!execution_wallet_id ||               →  execClass.target === 'REAL'
//   strategyExecutionTarget === 'REAL'
//
// canonicalExecutionMode === 'MOCK'      →  execClass.isMockExecution
//
// intent.source === 'manual' &&          →  execClass.isSystemOperator
//   intent.metadata?.system_operator_mode
// =============================================================================
