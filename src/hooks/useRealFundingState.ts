/**
 * useRealFundingState Hook
 * 
 * REAL MODE ONLY - Single source of truth for REAL funding UI state.
 * 
 * This hook determines which funding UI to show based on backend data.
 * It enforces the strict funding flow where users MUST register a wallet
 * before seeing any funding instructions.
 * 
 * States (mutually exclusive):
 * 
 * A - NO_WALLET: 
 *     Condition: 0 rows in user_external_addresses
 *     UI: "Add Funding Wallet" CTA, NO system address shown
 * 
 * B - WALLET_REGISTERED: 
 *     Condition: ≥1 external wallet exists, portfolio_capital NOT initialized
 *     UI: Success confirmation, system wallet address, funding instructions
 * 
 * C - PENDING_ATTRIBUTION: 
 *     Condition: Recent deposit detected, portfolio not yet credited
 *     UI: Pending status with tx hash
 * 
 * D - PORTFOLIO_FUNDED: 
 *     Condition: portfolio_capital exists with cash_balance_eur > 0
 *     UI: Portfolio balance, "Start Real Trading" CTA
 * 
 * INVARIANT: Funding instructions are NEVER shown in State A.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useExternalAddresses } from '@/hooks/useExternalAddresses';
import { logger } from '@/utils/logger';

export type RealFundingState = 
  | 'NO_WALLET'           // State A: No external funding wallet registered
  | 'WALLET_REGISTERED'   // State B: ≥1 wallet exists, portfolio not funded
  | 'PENDING_ATTRIBUTION' // State C: Deposit detected, awaiting attribution
  | 'PORTFOLIO_FUNDED';   // State D: Portfolio has capital

export interface RealFundingStateResult {
  state: RealFundingState;
  isLoading: boolean;
  error: string | null;
  
  // Derived booleans
  hasExternalWallet: boolean;
  isPortfolioFunded: boolean;
  canShowFundingInstructions: boolean;
  
  // Data
  externalWalletCount: number;
  systemWalletAddress: string | null;
  portfolioCapital: number | null;
  pendingDeposits: PendingDeposit[];
  
  // Actions
  refresh: () => Promise<void>;
}

export interface PendingDeposit {
  tx_hash: string;
  amount: number;
  asset: string;
  block_timestamp: string;
}

const POLL_INTERVAL_MS = 30000; // Poll every 30 seconds

export function useRealFundingState(): RealFundingStateResult {
  const { user } = useAuth();
  const { 
    addresses, 
    hasAddresses, 
    count: externalWalletCount, 
    isLoading: addressesLoading,
    refetch: refetchAddresses 
  } = useExternalAddresses();
  
  const [state, setState] = useState<RealFundingState>('NO_WALLET');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [systemWalletAddress, setSystemWalletAddress] = useState<string | null>(null);
  const [portfolioCapital, setPortfolioCapital] = useState<number | null>(null);
  const [pendingDeposits, setPendingDeposits] = useState<PendingDeposit[]>([]);

  const fetchState = useCallback(async () => {
    if (!user?.id) {
      setState('NO_WALLET');
      setIsLoading(false);
      return;
    }

    setError(null);

    try {
      // 1. Check if user has portfolio_capital (REAL mode)
      const { data: metricsData, error: metricsError } = await (supabase.rpc as any)(
        'get_portfolio_metrics',
        { p_user_id: user.id, p_is_test_mode: false }
      );

      if (metricsError) {
        logger.error('[useRealFundingState] Metrics error:', metricsError);
      }

      const isPortfolioInitialized = metricsData?.success === true;
      const capital = metricsData?.cash_balance_eur ?? null;

      setPortfolioCapital(isPortfolioInitialized ? capital : null);

      // 2. Get system execution wallet address
      const { data: walletData } = await (supabase
        .from('execution_wallets' as any)
        .select('wallet_address')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle() as any);

      setSystemWalletAddress(walletData?.wallet_address || null);

      // 3. Check for pending/recent deposits (deposit_attributions)
      const { data: recentDeposits } = await (supabase
        .from('deposit_attributions' as any)
        .select('tx_hash, amount, asset, block_timestamp')
        .eq('user_id', user.id)
        .order('block_timestamp', { ascending: false })
        .limit(5) as any);

      setPendingDeposits(recentDeposits || []);

      // 4. Determine state
      if (isPortfolioInitialized && capital > 0) {
        setState('PORTFOLIO_FUNDED');
      } else if (!hasAddresses) {
        setState('NO_WALLET');
      } else {
        // Has wallet(s) but no portfolio capital yet
        // Check if there are very recent deposits that might be pending
        const hasRecentDeposit = (recentDeposits || []).length > 0 && 
          new Date((recentDeposits[0] as any)?.block_timestamp).getTime() > Date.now() - 5 * 60 * 1000;
        
        if (hasRecentDeposit && !isPortfolioInitialized) {
          setState('PENDING_ATTRIBUTION');
        } else {
          setState('WALLET_REGISTERED');
        }
      }

    } catch (err) {
      logger.error('[useRealFundingState] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch funding state');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, hasAddresses]);

  // Initial fetch and polling
  useEffect(() => {
    fetchState();
    
    // Poll for state changes (deposit attribution, etc.)
    const interval = setInterval(fetchState, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchState]);

  // Refresh addresses when state changes require it
  useEffect(() => {
    if (!addressesLoading) {
      fetchState();
    }
  }, [addressesLoading, hasAddresses]);

  const refresh = useCallback(async () => {
    await refetchAddresses();
    await fetchState();
  }, [refetchAddresses, fetchState]);

  // Derived values
  const hasExternalWallet = hasAddresses;
  const isPortfolioFunded = state === 'PORTFOLIO_FUNDED';
  const canShowFundingInstructions = state === 'WALLET_REGISTERED' || state === 'PENDING_ATTRIBUTION';

  return {
    state,
    isLoading: isLoading || addressesLoading,
    error,
    hasExternalWallet,
    isPortfolioFunded,
    canShowFundingInstructions,
    externalWalletCount,
    systemWalletAddress,
    portfolioCapital,
    pendingDeposits,
    refresh,
  };
}
