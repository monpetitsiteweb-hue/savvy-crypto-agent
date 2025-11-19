/**
 * P&L SYSTEM - SOURCE OF TRUTH DOCUMENTATION
 * ===========================================
 * 
 * This document defines the authoritative data sources and calculation rules
 * for all profit & loss calculations across the trading platform.
 * 
 * CRITICAL: All UI components MUST use the same valuation service and price sources.
 */

const INTEGRITY_CHECKS = [
  'abs(purchase_value - amount × entry_price) ≤ 0.01',
  'abs(current_value - amount × current_price) ≤ 0.01',
  'amount > 0 AND entry_price > 0 AND purchase_value > 0'
];

export const SOURCE_OF_TRUTH_CONFIG = {
  
  // PRIMARY PRICE FEED
  price_feed: {
    provider: 'Coinbase Pro REST API',
    base_url: 'https://api.exchange.coinbase.com',
    endpoint_template: '/products/{SYMBOL}-EUR/ticker',
    refresh_cadence_ms: 30000, // 30 seconds for live prices
    cache_ttl_ms: 30000,
    
    // Pair mappings - ALL calculations use EUR as base
    supported_pairs: [
      'BTC-EUR', 'ETH-EUR', 'XRP-EUR', 'ADA-EUR', 'SOL-EUR',
      'DOT-EUR', 'AVAX-EUR', 'LINK-EUR', 'LTC-EUR'
    ],
    
    // Fallback behavior on feed outage
    fallback_strategy: 'use_cached_price_with_staleness_warning',
    max_staleness_ms: 300000, // 5 minutes before considering stale
    
    // Price normalization
    precision_digits: 18, // Full precision storage
    display_precision: 2   // 2 decimals for EUR amounts in UI
  },

  // HISTORICAL PRICE SNAPSHOTS
  price_snapshots: {
    table: 'price_snapshots',
    purpose: 'Deterministic historical prices for P&L backfill',
    source: 'Same Coinbase Pro API - 1-minute candles',
    retention_period: '90 days',
    primary_key: ['symbol', 'ts'],
    
    // Used for: corruption repair, audit trails, backtesting
    usage_rules: [
      'NEVER use random prices for backfill',
      'Always cite snapshot timestamp and source',
      'Log all corrections in mock_trades_fix_audit'
    ]
  },

  // VALUATION SERVICE (SINGLE SOURCE OF TRUTH)
  valuation_service: {
    file: 'src/utils/valuationService.ts',
    function: 'calculateValuation()',
    
    // Core formulas (immutable)
    formulas: {
      current_value: 'amount × current_price',
      pnl_eur: 'current_value - purchase_value',
      pnl_pct: '((current_price / entry_price) - 1) × 100'
    },
    
    // Input validation
    integrity_checks: INTEGRITY_CHECKS,
    
    // ALL UI components using this service
    consumers: [
      'UnifiedPortfolioDisplay.tsx - position cards',
      'PerformanceOverview.tsx - KPI totals', 
      'TradingHistory.tsx - historical P&L',
      'PoolExitManagementPanel.tsx - pool positions',
      'MergedPortfolioDisplay.tsx - combined view'
    ]
  },

  // KPI AGGREGATION RULES
  kpi_calculations: {
    unrealized_pnl: 'Σ (open_positions) pnl_eur',
    realized_pnl: 'Σ (closed_trades) (exit_value - purchase_value - fees)',
    total_pnl: 'realized_pnl + unrealized_pnl',
    
    // Exclusions
    exclude_from_aggregation: [
      'trades where is_corrupted = true',
      'trades where integrity_reason IS NOT NULL'
    ],
    
    // Precision rules
    rounding: 'ROUND(value * 100) / 100', // Nearest cent
    display_format: '€{amount} ({pct}%)'
  },

  // DATA INTEGRITY MONITORING
  integrity_monitoring: {
    nightly_check_function: 'supabase/functions/nightly-integrity-check',
    validation_rules: INTEGRITY_CHECKS,
    
    alert_conditions: [
      'newly_corrupted > 0 trades per day',
      'lock_contention > 1% over 15 minutes',  
      'coordinator_errors > 0 in 5 minutes',
      'decision_contradictions within cooldown periods'
    ],
    
    corruption_response: [
      'Tag trade with is_corrupted = true',
      'Set descriptive integrity_reason',
      'Show ⚠️ badge in UI',
      'Exclude from KPI aggregation',
      'Log in audit trail'
    ]
  },

  // BACKUP AND ROLLBACK
  backup_strategy: {
    before_any_modification: 'Export JSON snapshot of affected rows',
    storage_location: 'Local downloads + audit table',
    rollback_procedure: 'Restore from JSON + clear audit entries',
    
    safe_mode_toggle: {
      location: 'Strategy configuration panel',
      effect: 'All trade_decisions return HOLD_ALL',
      logging: 'Logged in trade_decisions_log with reason=safe_mode'
    }
  },

  // VERSION AND CHANGE CONTROL
  version: '1.0.0',
  last_updated: '2024-12-23',
  change_approval: 'Required for any modification to formulas or data sources',
  
  // VERIFICATION CHECKLIST
  verification_requirements: [
    'Before/after screenshots for position cards',
    'Raw values match valuation service outputs', 
    'KPI totals equal sum of individual positions',
    'No €100 placeholder leaks in current_price',
    'All UI panels call same valuation service',
    'Coordinator returns 200 with structured decisions',
    'Lock contention < 1% over 15 minutes'
  ]
};

/**
 * USAGE EXAMPLES:
 * 
 * ✅ CORRECT:
 * import { calculateValuation } from '@/utils/valuationService';
 * const result = await calculateValuation({symbol: 'BTC', amount: 1.0, entry_price: 45000, purchase_value: 45000});
 * 
 * ❌ NEVER DO:
 * const pnl = amount * 100 - purchase_value; // Using hardcoded €100
 * const current_value = Math.random() * 50000; // Random prices
 * const pnl_pct = (current_price - entry_price) / entry_price; // Wrong formula
 */

export default SOURCE_OF_TRUTH_CONFIG;