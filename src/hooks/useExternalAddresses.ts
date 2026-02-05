/**
 * useExternalAddresses Hook
 * 
 * Fetches user's registered external funding addresses.
 * Used to gate REAL mode funding UI - funding instructions
 * are only shown when at least one external wallet is registered.
 * 
 * Architecture:
 * - External wallets are the ONLY authority for REAL funding
 * - Deposits are attributed via 1:1 address matching
 * - No external wallet = no funding path available
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { logger } from '@/utils/logger';

const BASE_CHAIN_ID = 8453;

export interface ExternalAddress {
  id: string;
  address: string;
  label: string | null;
  chain_id: number;
  is_verified: boolean;
  source?: string;
  created_at: string;
}

interface UseExternalAddressesReturn {
  addresses: ExternalAddress[];
  count: number;
  hasAddresses: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useExternalAddresses(): UseExternalAddressesReturn {
  const { user } = useAuth();
  const [addresses, setAddresses] = useState<ExternalAddress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAddresses = useCallback(async () => {
    if (!user?.id) {
      setAddresses([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await (supabase
        .from('user_external_addresses' as any)
        .select('id, address, label, chain_id, is_verified, source, created_at')
        .eq('user_id', user.id)
        .eq('chain_id', BASE_CHAIN_ID)
        .order('created_at', { ascending: false }) as any);

      if (fetchError) throw fetchError;

      setAddresses(data || []);
    } catch (err) {
      logger.error('[useExternalAddresses] Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch addresses');
      setAddresses([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  return {
    addresses,
    count: addresses.length,
    hasAddresses: addresses.length > 0,
    isLoading,
    error,
    refetch: fetchAddresses,
  };
}
