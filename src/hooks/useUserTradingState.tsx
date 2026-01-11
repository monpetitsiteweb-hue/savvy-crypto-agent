import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';

/**
 * Canonical trading state progression:
 * TEST_ONLY -> COINBASE_CONNECTED -> WALLET_CREATED -> WALLET_FUNDED
 * 
 * State resolution (non-negotiable order):
 * 1. If execution wallet exists AND funded → WALLET_FUNDED
 * 2. Else if wallet exists → WALLET_CREATED  
 * 3. Else if Coinbase connection valid (via RPC) → COINBASE_CONNECTED
 * 4. Else → TEST_ONLY
 * 
 * This is the SINGLE SOURCE OF TRUTH for user trading readiness.
 * All components (Header, WelcomeModal, Portfolio) must use this hook.
 */
export type TradingState = 
  | 'TEST_ONLY'           // No Coinbase, no wallet (default)
  | 'COINBASE_CONNECTED'  // Coinbase valid, no wallet
  | 'WALLET_CREATED'      // Wallet exists, not funded
  | 'WALLET_FUNDED';      // Wallet funded → REAL allowed

export interface UserTradingStateResult {
  state: TradingState;
  isLoading: boolean;
  error: string | null;
  
  // Derived booleans for convenience
  isCoinbaseConnected: boolean;
  hasWallet: boolean;
  isWalletFunded: boolean;
  canTradeLive: boolean;
  
  // Wallet details (when available)
  walletAddress: string | null;
  
  // Refresh function
  refresh: () => Promise<void>;
}

export function useUserTradingState(): UserTradingStateResult {
  const { user } = useAuth();
  const [state, setState] = useState<TradingState>('TEST_ONLY');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    if (!user?.id) {
      setState('TEST_ONLY');
      setWalletAddress(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // STEP 1: Check execution wallet FIRST (higher priority in state resolution)
      // Cast to bypass type checking - table exists but not in generated types
      const walletQuery = supabase
        .from('execution_wallets' as any)
        .select('wallet_address, is_active, is_funded')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      
      const { data: walletData, error: walletError } = await walletQuery as any;
      
      if (walletError) {
        console.error('[useUserTradingState] Wallet query error:', walletError);
      }
      
      // If wallet exists, determine state from wallet
      if (walletData) {
        setWalletAddress(walletData.wallet_address);
        if (walletData.is_funded) {
          setState('WALLET_FUNDED');
        } else {
          setState('WALLET_CREATED');
        }
        setIsLoading(false);
        return;
      }
      
      // STEP 2: No wallet - check Coinbase connection via canonical RPC
      // Cast to bypass type checking - RPC exists but not in generated types
      const { data: coinbaseConnected, error: cbError } = await (supabase.rpc as any)(
        'get_coinbase_connection_status'
      );
      
      if (cbError) {
        console.error('[useUserTradingState] Coinbase RPC error:', cbError);
        // If RPC fails, assume not connected
      }
      
      if (coinbaseConnected === true) {
        setState('COINBASE_CONNECTED');
      } else {
        setState('TEST_ONLY');
      }
      setWalletAddress(null);
      
    } catch (err) {
      console.error('[useUserTradingState] Unexpected error:', err);
      setError('Failed to determine trading state');
      setState('TEST_ONLY');
      setWalletAddress(null);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // Derived values
  const isCoinbaseConnected = state !== 'TEST_ONLY';
  const hasWallet = state === 'WALLET_CREATED' || state === 'WALLET_FUNDED';
  const isWalletFunded = state === 'WALLET_FUNDED';
  const canTradeLive = state === 'WALLET_FUNDED';

  return {
    state,
    isLoading,
    error,
    isCoinbaseConnected,
    hasWallet,
    isWalletFunded,
    canTradeLive,
    walletAddress,
    refresh: fetchState,
  };
}
