import { supabase } from '@/integrations/supabase/client';

export async function fetchZeroExQuote(payload: any) {
  const { data, error } = await supabase.functions.invoke('onchain-quote', {
    body: payload
  });
  
  if (error) throw new Error(error.message);
  return data;
}