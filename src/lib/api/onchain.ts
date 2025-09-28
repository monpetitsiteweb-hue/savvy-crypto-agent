import { supabase } from '@/integrations/supabase/client';

export async function fetchZeroExQuote(payload: any) {
  const { data, error } = await supabase.functions.invoke('onchain-quote', {
    body: payload
  });
  
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchOnchainQuote(payload: { 
  chainId: number;
  base: string;
  quote: string;
  side: 'BUY' | 'SELL';
  amount: number | string;
  slippageBps?: number;
  provider: '0x' | '1inch' | 'cow' | 'uniswap';
  from?: string;
}) {
  const { data, error } = await supabase.functions.invoke('onchain-quote', {
    body: payload
  });
  
  if (error) throw new Error(error.message);
  return data;
}