import { supabase } from '@/integrations/supabase/client';

export const runBackfillTest = async () => {
  try {
    console.log('🔥 TESTING: Running backfill function...');
    
    const { data, error } = await supabase.functions.invoke('backfill-sell-snapshots', {
      body: {}
    });

    if (error) {
      console.error('❌ BACKFILL TEST: Error:', error);
      return { success: false, error };
    }

    console.log('✅ BACKFILL TEST: Success:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ BACKFILL TEST: Exception:', error);
    return { success: false, error };
  }
};