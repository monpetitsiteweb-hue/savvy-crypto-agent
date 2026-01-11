import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';

/**
 * Canonical trading state progression:
 * TEST_ONLY -> COINBASE_CONNECTED -> WALLET_CREATED -> WALLET_FUNDED
 * 
 * This is the SINGLE SOURCE OF TRUTH for user trading readiness.
 * All components (Header, WelcomeModal, Portfolio) must use this hook.
 */
export type TradingState = 
  | 'TEST_ONLY'        // No Coinbase connection (default state)
  | 'COINBASE_CONNECTED' // Has valid, non-expired Coinbase connection
  | 'WALLET_CREATED'   // Has execution wallet created
  | 'WALLET_FUNDED';   // Wallet is funded and ready for live trading

export interface UserTradingStateResult {
  state: TradingState;
  isLoading: boolean;
  error: string | null;
  
  // Derived booleans for convenience
  isCoinbaseConnected: boolean;
  hasWallet: boolean;
  isWalletFunded: boolean;
  canTradeLive: boolean;
  
  // Refresh function
  refresh: () => Promise<void>;
}

export function useUserTradingState(): UserTradingStateResult {
  const { user } = useAuth();
  const [state, setState] = useState<TradingState>('TEST_ONLY');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchState = async () => {
    if (!user?.id) {
      setState('TEST_ONLY');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Check Coinbase connection via canonical RPC (secure, non-leaky)
      // Cast to any to bypass type checking since this RPC was just created
      const { data: coinbaseConnected, error: cbError } = await (supabase.rpc as any)(
        'get_coinbase_connection_status'
      );
      
      if (cbError) {
        console.error('[useUserTradingState] Coinbase RPC error:', cbError);
        // If RPC fails, assume not connected
      }
      
      const hasCoinbase = coinbaseConnected === true;
      
      if (!hasCoinbase) {
        setState('TEST_ONLY');
        setIsLoading(false);
        return;
      }
      
      // 2. Check execution wallet status
      // Use explicit any cast for table not in generated types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const walletResult: any = await (supabase as any)
        .from('execution_wallets')
        .select('is_active, is_funded')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      
      const walletData = walletResult?.data;
      const walletError = walletResult?.error;
      
      if (walletError) {
        console.error('[useUserTradingState] Wallet query error:', walletError);
        // If query fails, assume no wallet
      }
      
      if (!walletData) {
        setState('COINBASE_CONNECTED');
        setIsLoading(false);
        return;
      }
      
      if (walletData.is_funded) {
        setState('WALLET_FUNDED');
      } else {
        setState('WALLET_CREATED');
      }
      
    } catch (err) {
      console.error('[useUserTradingState] Unexpected error:', err);
      setError('Failed to determine trading state');
      setState('TEST_ONLY');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, [user?.id]);

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
    refresh: fetchState,
  };
}
